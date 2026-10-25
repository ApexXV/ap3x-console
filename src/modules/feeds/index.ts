import { el, setTone } from "../../core/dom";
import { note, sec } from "../../core/detail";
import { ageText } from "../../core/format";
import type { ModuleManifest, SourceSpec, SourceStatus, Tone } from "../../core/types";

/* Health of the console's own data feeds: a stopped collector leaves its file in place, so each
 * feed's own timestamp is checked against its cadence, alongside reachability. */

export interface FeedRow { id: string; label: string; status: SourceStatus; ageMs: number | null; maxAgeMs: number | null; quiet: boolean }
export interface FeedsModel { feeds: FeedRow[]; problems: FeedRow[] }

export const WATCHED: (SourceSpec & { label: string; quiet?: boolean })[] = [
  { id: "status", label: "Tracker API", url: "/api/status" },
  { id: "workloads", label: "Media workloads (MA001)", url: "/api/ops/workloads", stampField: "generated_at", maxAgeMs: 5 * 60_000 },
  { id: "media-sessions", label: "Media sessions", url: "/media-sessions-data/current.json", stampField: "generated_at", maxAgeMs: 2 * 60_000 },
  { id: "youtube", label: "YouTube archive", url: "/youtube-archive-data/current.json", stampField: "generated_at", maxAgeMs: 3 * 60_000 },
  { id: "node-status", label: "Node status", url: "/node-status-data/current.json", stampField: "generated_at", maxAgeMs: 5 * 60_000 },
  { id: "airspace", label: "Airspace", url: "/airspace-data/current.json", stampField: "generated_at", maxAgeMs: 10 * 60_000 },
  { id: "capacity", label: "AI capacity", url: "/ai-capacity-data/current.json", stampField: "generated_at", maxAgeMs: 60 * 60_000 },
  { id: "clickup", label: "ClickUp (FM)", url: "/clickup-data/current.json", stampField: "generated_at", maxAgeMs: 15 * 60_000 },
  { id: "ledger", label: "Deductions ledger", url: "/deductions-data/current.json", stampField: "generated_at", maxAgeMs: 20 * 60_000 },
  { id: "printers", label: "Lab printers", url: "/printers-data/current.json", stampField: "generated_at", maxAgeMs: 3 * 60_000, optional: true },
  // Listed but never alerting: the bank route is IP-restricted, so some screens are refused by design.
  { id: "bank", label: "Bank sync", url: "/api/wall/business-banking", quiet: true },
];

const bad = (s: SourceStatus) => s === "down" || s === "stale";
const toneOf = (f: FeedRow): Tone => (f.status === "ok" ? "good" : f.status === "retained" ? "warn" : f.status === "unknown" ? "muted" : f.quiet ? "muted" : "bad");

export const feedsModule: ModuleManifest<FeedsModel> = {
  id: "feed-health",
  title: "CONSOLE FEEDS",
  description: "Whether each data feed is updating, with its age against its expected cadence.",
  version: "1.0.0",
  sources: WATCHED.map(({ label: _label, quiet: _quiet, ...spec }) => spec),

  model(ctx) {
    const feeds = WATCHED
      .filter((w) => !w.optional || ctx.sources[w.id]?.seen)
      .map((w) => {
        const s = ctx.sources[w.id];
        return { id: w.id, label: w.label, status: s?.status ?? "unknown", ageMs: s?.ageMs ?? null, maxAgeMs: w.maxAgeMs ?? null, quiet: Boolean(w.quiet) };
      });
    return { feeds, problems: feeds.filter((f) => bad(f.status) && !f.quiet) };
  },

  render(body, m) {
    const grid = el("ol", "feed-dots");
    grid.append(...m.feeds.map((f) => {
      const li = el("li");
      setTone(li, toneOf(f));
      li.title = `${f.label}: ${f.status}`;
      li.append(el("i", "dot"), el("span", "", f.label));
      return li;
    }));
    body.replaceChildren(grid);
  },

  chip: (m) => (m.problems.length ? { label: `${m.problems.length} NEED ATTENTION`, tone: "bad" } : { label: "ALL UPDATING", tone: "good" }),

  detail(m) {
    const grid = el("ol", "feed-grid");
    grid.append(...m.feeds.map((f) => {
      const li = el("li");
      setTone(li, toneOf(f));
      const copy = el("div");
      copy.append(el("b", "", f.label), el("small", "", f.status === "down" ? "Unreachable"
        : f.ageMs !== null ? `Updated ${ageText(f.ageMs)} ago${f.maxAgeMs ? ` · stale after ${ageText(f.maxAgeMs)}` : ""}`
          : f.status === "retained" ? "Showing last good data" : f.status === "unknown" ? "Not checked yet" : "Reachable"));
      li.append(copy, el("em", "", f.status.toUpperCase()));
      return li;
    }));
    return {
      title: "CONSOLE FEEDS", chip: this.chip!(m), foot: "Feeds marked muted are listed but never alert",
      columns: "minmax(0, 1fr)", rows: "minmax(0, 1fr)",
      sections: [sec(m.problems.length ? `${m.problems.length} NEED ATTENTION` : "ALL UPDATING", m.feeds.length ? grid : note("No feeds checked yet."))],
    };
  },

  changes(previous, next) {
    return next.feeds.flatMap((f) => {
      const before = previous.feeds.find((p) => p.id === f.id);
      if (!before || before.status === f.status || f.quiet) return [];
      if (bad(f.status) && !bad(before.status)) return [{ tone: "warn" as Tone, kicker: "FEED", text: `${f.label} feed ${f.status === "down" ? "unreachable" : "stopped updating"}` }];
      if (!bad(f.status) && bad(before.status)) return [{ tone: "good" as Tone, kicker: "FEED", text: `${f.label} feed updating again` }];
      return [];
    });
  },

  priority(m) {
    const first = m.problems[0];
    if (!first) return null;
    return {
      rank: 80, kicker: "CONSOLE / FEEDS",
      title: `${first.label} feed ${first.status === "down" ? "unreachable" : `stopped ${ageText(first.ageMs)} ago`}`,
      summary: m.problems.length > 1 ? `${m.problems.length} feeds need attention: ${m.problems.map((f) => f.label).join(", ")}` : "Its collector or service may have stopped; panels show its last data.",
      posture: "CHECK", tone: "warn",
    };
  },

  demo(now) {
    const fresh = { generated_at: new Date(now - 40_000).toISOString() };
    return Object.fromEntries(WATCHED.map((w) => [w.id, w.id === "capacity" ? { generated_at: new Date(now - 95 * 60_000).toISOString() } : fresh]));
  },
};
