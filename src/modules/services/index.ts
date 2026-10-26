import { el, setTone } from "../../core/dom";
import { dlist, sec } from "../../core/detail";
import { bool, pick, rows, text, toneFor } from "../../core/format";
import type { ModuleManifest, Tone } from "../../core/types";

/* Named services matched by alias against whatever the status API and ops brief report
 * (service lists or container lists). The list of services is a module setting. */

export interface ServiceRow { name: string; state: string; online: boolean | null }
export interface ServicesModel { services: ServiceRow[]; known: number; online: number }

export const DEFAULT_SERVICES: [string, string[]][] = [
  ["Plex", ["plex"]], ["qBittorrent", ["qbittorrent", "qbit"]], ["Sonarr", ["sonarr"]], ["Radarr", ["radarr"]],
  ["Prowlarr", ["prowlarr"]], ["Readarr", ["readarr"]], ["Portainer", ["portainer"]], ["Home Assistant", ["home assistant", "homeassistant"]],
  ["QuickSilver", ["quicksilver"]], ["Epsilon", ["epsilon", "priority-alpha-bot", "priority alpha bot"]],
  ["Camera Alpha", ["camera alpha", "camera-alpha", "go2rtc"]], ["Tailscale", ["tailscale"]],
];

export function parseServices(payloads: unknown[], wanted: [string, string[]][]): ServicesModel {
  const found: Record<string, unknown>[] = [];
  for (const payload of payloads) {
    for (const candidate of [pick(payload, ["services", "service_status", "status.services", "data.services", "system.services"]),
      pick(payload, ["containers", "docker.containers", "status.containers"])]) found.push(...rows(candidate));
  }
  const list = found.flatMap((row) => {
    const name = text(row.name, row.service, row.container, row.display_name, row.id);
    if (!name) return [];
    const state = (text(row.state, row.status, row.health, row.value) ?? "UNKNOWN").toUpperCase();
    return [{ name: name.toLowerCase(), state, online: bool(row.online, row.active, row.healthy, state) }];
  });
  const services = wanted.map(([label, aliases]) => {
    const match = list.find((s) => aliases.some((alias) => s.name.includes(alias.toLowerCase())));
    return { name: label, state: match?.state ?? "UNKNOWN", online: match?.online ?? null };
  });
  const known = services.filter((s) => s.online !== null);
  return { services, known: known.length, online: known.filter((s) => s.online).length };
}

const toneOf = (s: ServiceRow): Tone => (s.online === true ? "good" : s.online === false ? "bad" : toneFor(s.state));

export const servicesModule: ModuleManifest<ServicesModel, { services: [string, string[]][] }> = {
  id: "services",
  title: "SERVICES",
  description: "A configurable list of services, each matched by alias against the host's service and container status.",
  version: "1.0.0",
  defaults: { services: DEFAULT_SERVICES },
  sources: [{ id: "status", url: "/api/status" }, { id: "ops-brief", url: "/api/ops/brief" }],

  model: (ctx) => parseServices([ctx.sources.status?.data, ctx.sources["ops-brief"]?.data], ctx.settings.services),

  render(body, m) {
    const grid = el("div", "service-grid");
    grid.append(...m.services.map((s) => {
      const tile = el("div", "service");
      setTone(tile, toneOf(s));
      tile.append(el("i"), el("b", "", s.name), el("span", "", s.state));
      return tile;
    }));
    body.replaceChildren(grid);
  },

  regionChip(m) {
    const down = m.services.filter((s) => s.online === false).length;
    return down ? { label: `${down} SERVICE${down === 1 ? "" : "S"} DOWN`, tone: "warn" } : null;
  },
  chip: (m) => (!m.known ? { label: "UNKNOWN", tone: "muted" } : { label: `${m.online}/${m.known} ONLINE`, tone: m.services.every((s) => s.online !== false) ? "good" : "warn" }),

  detail(m) {
    const third = Math.ceil(m.services.length / 3);
    return {
      title: "SERVICES", chip: this.chip!(m), foot: "Service states from the status API and operator brief",
      columns: "repeat(3, minmax(0, 1fr))", rows: "minmax(0, 1fr)",
      sections: [0, 1, 2].map((col) => sec(null, dlist(m.services.slice(col * third, col * third + third).map((s) => ({
        title: s.name, detail: s.online === true ? "Online" : s.online === false ? "Offline or degraded" : "No status reported", tag: s.state, tone: toneOf(s),
      }))))),
    };
  },

  changes(a, b) {
    return b.services.flatMap((s) => {
      const before = a.services.find((x) => x.name === s.name);
      if (before?.online === true && s.online === false) return [{ tone: "bad" as Tone, kicker: "SERVICE DOWN", text: `${s.name} is ${s.state}` }];
      if (before?.online === false && s.online === true) return [{ tone: "good" as Tone, kicker: "SERVICE RECOVERED", text: `${s.name} is back online` }];
      return [];
    });
  },

  priority(m) {
    const down = m.services.filter((s) => s.online === false);
    return down.length ? { rank: 55, kicker: "SERVICES / DOWN", title: `${down.map((s) => s.name).join(", ")} ${down.length === 1 ? "is" : "are"} down`, summary: down.map((s) => `${s.name}: ${s.state}`).join(" · "), posture: "WATCH", tone: "warn" } : null;
  },

  demo() {
    return {
      status: { services: DEFAULT_SERVICES.map(([name], i) => ({ name: name.toLowerCase(), state: i === 5 ? "DEGRADED" : "ONLINE", online: i !== 5 })) },
      "ops-brief": { posture: "NOMINAL" },
    };
  },
};
