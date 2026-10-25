import { el, setTone } from "../../core/dom";
import { dlist, note, sec } from "../../core/detail";
import { asDict, dayLabel, rows, sinceMs, text } from "../../core/format";
import type { ModuleManifest, Tone } from "../../core/types";

/* Which machines are reachable, from the AP3X-NODE-STATUS-1 feed (Tailscale peers, then a LAN ping). */

export interface NodeRow { name: string; state: "ONLINE" | "OFFLINE" | "UNKNOWN"; source: string; lastSeen: string | null }
export interface NodesModel { status: "LIVE" | "STALE" | "NO FEED"; tailscale: string | null; nodes: NodeRow[] }

const STALE_MS = 5 * 60_000;
const toneOf = (state: NodeRow["state"]): Tone => (state === "ONLINE" ? "good" : state === "OFFLINE" ? "bad" : "muted");

export function parseNodes(payload: unknown, now: number, expected: string[]): NodesModel {
  const feed = asDict(payload);
  if (feed.schema_version !== "AP3X-NODE-STATUS-1") {
    return { status: "NO FEED", tailscale: null, nodes: expected.map((name) => ({ name, state: "UNKNOWN", source: "NO FEED", lastSeen: null })) };
  }
  const published = new Map(rows(feed.nodes).map((n) => [String(n.name ?? "").toUpperCase(), n]));
  const names = expected.length ? expected : [...published.keys()];
  const age = sinceMs(feed.generated_at, now);
  return {
    status: age === null || age > STALE_MS ? "STALE" : "LIVE",
    tailscale: text(feed.tailscale),
    nodes: names.map((name) => {
      const n = published.get(name);
      const state = text(n?.state)?.toUpperCase();
      return {
        name, state: state === "ONLINE" || state === "OFFLINE" ? state : "UNKNOWN",
        source: text(n?.source)?.toUpperCase() ?? "NOT IN FEED", lastSeen: text(n?.last_seen),
      };
    }),
  };
}

export const nodesModule: ModuleManifest<NodesModel, { nodes: string[] }> = {
  id: "node-status",
  title: "NODES",
  description: "Online / offline state of each machine, from Tailscale with a LAN ping fallback.",
  version: "1.0.0",
  defaults: { nodes: [] },
  sources: [{ id: "node-status", url: "/node-status-data/current.json", schema: "AP3X-NODE-STATUS-1", stampField: "generated_at", maxAgeMs: STALE_MS }],

  model: (ctx) => parseNodes(ctx.sources["node-status"]?.data, ctx.now, (ctx.settings.nodes ?? []).map((n) => String(n).toUpperCase())),

  render(body, m) {
    const list = el("ol", "node-list");
    list.append(...m.nodes.map((n) => {
      const li = el("li");
      setTone(li, toneOf(n.state));
      li.append(el("i", "dot"), el("b", "", n.name), el("em", "", n.state));
      return li;
    }));
    body.replaceChildren(list);
  },

  chip(m) {
    if (m.status === "NO FEED") return { label: "NO FEED", tone: "muted" };
    const down = m.nodes.filter((n) => n.state !== "ONLINE").length;
    return down ? { label: `${down} NOT ONLINE`, tone: "warn" } : { label: `${m.nodes.length} ONLINE`, tone: m.status === "STALE" ? "warn" : "good" };
  },

  detail(m, ctx) {
    return {
      title: "NODES",
      chip: this.chip!(m),
      foot: `Tailscale ${m.tailscale ?? "unknown"} · feed ${m.status.toLowerCase()}`,
      columns: "minmax(0, 1fr)", rows: "minmax(0, 1fr)",
      sections: [sec("MACHINES", m.nodes.length ? dlist(m.nodes.map((n) => ({
        title: n.name, tag: n.state, tone: toneOf(n.state),
        detail: `Decided by ${n.source.toLowerCase()}${n.lastSeen ? ` · last seen ${dayLabel(n.lastSeen, ctx.now)}` : ""}`,
      }))) : note("No nodes listed."))],
    };
  },

  changes(previous, next) {
    return next.nodes.flatMap((n) => {
      const before = previous.nodes.find((p) => p.name === n.name)?.state;
      if (before === "ONLINE" && n.state === "OFFLINE") return [{ tone: "bad" as Tone, kicker: "NODE OFFLINE", text: `${n.name} went offline` }];
      if (before === "OFFLINE" && n.state === "ONLINE") return [{ tone: "good" as Tone, kicker: "NODE ONLINE", text: `${n.name} is back online` }];
      return [];
    });
  },

  priority(m) {
    const offline = m.nodes.filter((n) => n.state === "OFFLINE");
    return offline.length ? { rank: 60, kicker: "NODES / OFFLINE", title: `${offline.map((n) => n.name).join(", ")} offline`, summary: "Not reachable over Tailscale or the LAN.", posture: "WATCH", tone: "warn" } : null;
  },

  demo(now) {
    const at = new Date(now).toISOString();
    return {
      "node-status": {
        schema_version: "AP3X-NODE-STATUS-1", generated_at: at, tailscale: "LIVE",
        nodes: [
          { name: "RACKMAIN1", state: "ONLINE", source: "self", last_seen: at },
          { name: "RACKPI1", state: "ONLINE", source: "lan", last_seen: at },
          { name: "RACKPI2", state: "ONLINE", source: "lan", last_seen: at },
          { name: "APEXTOWER", state: "ONLINE", source: "tailscale", last_seen: at },
          { name: "LABPI1", state: "OFFLINE", source: "tailscale", last_seen: new Date(now - 26 * 3_600_000).toISOString() },
        ],
      },
    };
  },
};
