import { el, setTone, toneVar } from "../../core/dom";
import { dlist, note, place, sec, stats } from "../../core/detail";
import { ageLabel, num, pick, sinceMs, text, toneFor } from "../../core/format";
import type { ModuleManifest, Tone } from "../../core/types";
import { parseNodes, type NodeRow } from "../nodes";
import "./host.css";

/* The host server: CPU, memory, disks, load, uptime, API latency, containers, posture, and its nodes. */

export interface HostModel {
  available: boolean;
  cpu: number | null; mem: number | null; root: number | null; media: number | null;
  mediaUsed: number | null; mediaTotal: number | null;
  load: number | null; uptime: number | null; latency: number | null; containers: number | null;
  posture: string; nodes: NodeRow[];
}

export function parseHost(status: unknown, brief: unknown, latency: number | null): Omit<HostModel, "nodes"> {
  const n = (paths: string[]) => num(pick(status, paths));
  return {
    available: status !== null && status !== undefined,
    cpu: n(["system.cpu_percent", "host.cpu_percent", "cpu_percent", "resources.cpu.percent", "cpu.usage_percent"]),
    mem: n(["system.memory_percent", "host.memory_percent", "memory_percent", "resources.memory.percent", "memory.used_percent"]),
    root: n(["system.root_percent", "host.root_percent", "root_percent", "resources.root.percent", "disk.root.percent"]),
    media: n(["system.media_percent", "host.media_percent", "media_percent", "resources.media.percent", "disk.media.percent"]),
    mediaUsed: n(["system.media_used_tb", "host.media_used_tb", "resources.media.used_tb", "disk.media.used_tb"]),
    mediaTotal: n(["system.media_total_tb", "host.media_total_tb", "resources.media.total_tb", "disk.media.total_tb"]),
    load: n(["system.load_1m", "host.load_1m", "load_1m", "load.one", "resources.load"]),
    uptime: n(["system.uptime_seconds", "host.uptime_seconds", "uptime_seconds"]),
    latency,
    containers: n(["container_count", "containers.running_count", "docker.running", "docker.container_count"]),
    posture: (text(pick(brief, ["posture", "state", "status", "alpha.posture"])) ?? "UNKNOWN").toUpperCase(),
  };
}

const uptimeText = (s: number | null) => (s === null ? "—" : `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`);
const ringTone = (v: number | null): Tone => (v === null ? "muted" : v >= 90 ? "bad" : v >= 75 ? "warn" : "info");
const NS = "http://www.w3.org/2000/svg";

function ring(value: number | null, label: string): HTMLElement {
  const fig = el("figure", "ring");
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 120 120");
  for (const cls of ["track", "arc"]) {
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("cx", "60"); c.setAttribute("cy", "60"); c.setAttribute("r", "50"); c.setAttribute("class", cls);
    if (cls === "arc") c.setAttribute("pathLength", "100");
    svg.append(c);
  }
  fig.style.setProperty("--off", String(100 - Math.max(0, Math.min(100, value ?? 0))));
  fig.style.setProperty("--tone", toneVar(ringTone(value)));
  const cap = el("figcaption");
  cap.append(el("b", "", value === null ? "—" : `${Math.round(value)}%`), el("span", "", label));
  fig.append(svg, cap);
  return fig;
}

const mediaLabel = (h: HostModel) => (h.mediaUsed !== null && h.mediaTotal !== null ? `${h.mediaUsed.toFixed(1)}/${h.mediaTotal.toFixed(0)} TB` : "MEDIA");
const nodeTone = (s: NodeRow["state"]): Tone => (s === "ONLINE" ? "good" : s === "OFFLINE" ? "bad" : "muted");

export const hostModule: ModuleManifest<HostModel, { name: string; nodes: string[] }> = {
  id: "host",
  title: "HOST",
  description: "The host server's CPU, memory, disks, load, uptime, API latency, containers, and its network nodes.",
  version: "1.0.0",
  defaults: { name: "RACKMAIN1", nodes: ["RACKMAIN1", "RACKPI1", "RACKPI2", "APEXTOWER"] },
  sources: [
    { id: "status", url: "/api/status" },
    { id: "ops-brief", url: "/api/ops/brief" },
    { id: "node-status", url: "/node-status-data/current.json", schema: "AP3X-NODE-STATUS-1", stampField: "generated_at", maxAgeMs: 5 * 60_000 },
  ],

  model(ctx) {
    const status = ctx.sources.status;
    const fresh = status?.status === "ok";
    const host = parseHost(status?.data ?? null, ctx.sources["ops-brief"]?.data ?? null, fresh ? status?.latencyMs ?? null : null);
    const nodes = parseNodes(ctx.sources["node-status"]?.data, ctx.now, ctx.settings.nodes.map((n) => n.toUpperCase())).nodes
      .map((n) => (n.state === "UNKNOWN" && n.name === ctx.settings.name.toUpperCase() && fresh ? { ...n, state: "ONLINE" as const, source: "STATUS API" } : n));
    return { ...host, nodes };
  },

  render(body, h) {
    const rings = el("div", "rings");
    rings.append(ring(h.cpu, "CPU"), ring(h.mem, "MEMORY"), ring(h.root, "ROOT"), ring(h.media, mediaLabel(h)));
    const facts = el("div", "facts host-facts");
    for (const [k, v] of [["LOAD 1M", h.load === null ? "—" : h.load.toFixed(2)], ["UPTIME", uptimeText(h.uptime)],
      ["API LATENCY", h.latency === null ? "—" : `${Math.round(h.latency)} ms`], ["CONTAINERS", h.containers === null ? "—" : String(h.containers)]]) {
      const cell = el("div");
      cell.append(el("span", "", k), el("b", "", v));
      facts.append(cell);
    }
    const nodes = el("div", "host-nodes");
    nodes.append(...h.nodes.map((n) => {
      const node = el("div");
      setTone(node, nodeTone(n.state));
      node.append(el("span", "", n.name), el("b", "", n.state));
      return node;
    }));
    body.replaceChildren(rings, facts, nodes);
  },

  chip: (h) => ({ label: h.available ? h.posture : "NO STATUS", tone: h.available ? toneFor(h.posture) : "muted" }),

  detail(h, ctx) {
    const rings = el("div", "rings is-large");
    rings.append(ring(h.cpu, "CPU"), ring(h.mem, "MEMORY"), ring(h.root, "ROOT"), ring(h.media, `MEDIA ${mediaLabel(h)}`));
    return {
      title: `${ctx.settings.name.toUpperCase()} HOST`,
      chip: this.chip!(h),
      foot: "Same-origin status API on the host",
      columns: "minmax(0, 1.4fr) minmax(0, 1fr)", rows: "auto minmax(0, 1fr)",
      sections: [
        place(stats([["LOAD 1M", h.load === null ? null : h.load.toFixed(2)], ["UPTIME", h.uptime === null ? null : uptimeText(h.uptime)],
          ["API LATENCY", h.latency === null ? null : `${Math.round(h.latency)} ms`], ["CONTAINERS", h.containers], ["POSTURE", h.posture, toneFor(h.posture)]]), "1 / -1"),
        sec("RESOURCES", rings),
        sec("NODES", dlist(h.nodes.map((n) => ({
          title: n.name, tag: n.state, tone: nodeTone(n.state),
          detail: `via ${n.source.toLowerCase()}${n.state !== "ONLINE" && n.lastSeen ? ` · last seen ${ageLabel(sinceMs(n.lastSeen, ctx.now)).toLowerCase()}` : ""}`,
        }))), note("Node states come from Tailscale on the host, with a LAN ping fallback, refreshed every minute.")),
      ],
    };
  },

  priority(h) {
    const full = [["memory", h.mem], ["root disk", h.root], ["media disk", h.media]].filter(([, v]) => typeof v === "number" && v >= 95) as [string, number][];
    const first = full[0];
    return first ? { rank: 45, kicker: "HOST / RESOURCES", title: `Host ${first[0]} at ${Math.round(first[1])}%`, summary: full.map(([k, v]) => `${k} ${Math.round(v)}%`).join(" · "), posture: "WATCH", tone: "warn" } : null;
  },

  demo(now) {
    return {
      status: { system: { cpu_percent: 23, memory_percent: 61, root_percent: 48.2, media_percent: 72.6, media_used_tb: 43.6, media_total_tb: 60, load_1m: 1.96, uptime_seconds: 16 * 86400 + 3600 * 2 }, container_count: 31 },
      "ops-brief": { posture: "NOMINAL", summary: "All systems nominal" },
      "node-status": {
        schema_version: "AP3X-NODE-STATUS-1", generated_at: new Date(now).toISOString(), tailscale: "LIVE",
        nodes: ["RACKMAIN1", "RACKPI1", "RACKPI2", "APEXTOWER"].map((name) => ({ name, state: "ONLINE", source: name === "RACKMAIN1" ? "self" : "lan", last_seen: new Date(now).toISOString() })),
      },
    };
  },
};
