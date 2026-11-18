import { sec } from "../../core/detail";
import { el, privateText, replaceKeepingScroll, tag, tile, tileRow } from "../../core/dom";
import type { ModuleManifest } from "../../core/types";
import { parseSnapshot } from "./parse";
import type { Snapshot, Transfer } from "./parse";
import "./snapshot.css";

const stamp = (value: string): string => new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric",
  hour: "numeric", minute: "2-digit", timeZoneName: "short",
}).format(new Date(value));

const remaining = (n: number): string => n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB`
  : n >= 1e6 ? `${(n / 1e6).toFixed(2)} MB` : n >= 1000 ? `${(n / 1000).toFixed(1)} kB` : `${n} B`;

function transferRow(row: Transfer): HTMLTableRowElement {
  const tr = el("tr");
  tr.dataset.transferId = row.id;
  const series = el("th");
  series.scope = "row";
  series.append(privateText(el("b", "", row.series)), el("small", "", row.episodes));
  const progress = el("td");
  const meter = el("progress");
  meter.max = 100; meter.value = row.progress_pct; meter.setAttribute("aria-label", "Transfer progress");
  progress.append(el("b", "", `${row.progress_pct}%`), meter);
  const gap = el("td");
  gap.append(el("b", "", String(row.gap_count)), el("small", "", row.gap_episodes || "None"));
  const state = el("td");
  state.append(tag(row.state === "missing_files" ? "Missing files" : "Stalled", row.state === "missing_files" ? "bad" : "warn"));
  tr.append(series, state, progress, el("td", "snap-bytes", remaining(row.remaining_bytes)), gap);
  return tr;
}

function roster(m: Snapshot): HTMLElement {
  const scroll = el("div", "snap-scroll");
  scroll.dataset.preserveScroll = "transfer-table";
  scroll.tabIndex = 0; scroll.setAttribute("role", "region"); scroll.setAttribute("aria-label", "Flagged transfer table");
  const table = el("table", "snap-table"); table.setAttribute("aria-label", "Saved Sonarr transfers");
  const header = table.createTHead().insertRow();
  for (const title of ["Transfer / queued episodes", "Client state", "Progress", "Remaining", "Library gaps"]) {
    const th = el("th", "", title); th.scope = "col"; header.append(th);
  }
  table.createTBody().append(...m.transfers.map(transferRow)); scroll.append(table);
  return scroll;
}

function evidence(m: Snapshot): HTMLElement {
  const wrap = el("aside", "snap-evidence");
  wrap.setAttribute("aria-label", "Family Guy verification");
  wrap.dataset.preserveScroll = "season-evidence";
  wrap.tabIndex = 0;
  wrap.append(privateText(el("h4", "", "Family Guy verification")));
  for (const s of m.resolved) {
    const resolved = s.indexed === s.total && s.queue_records === 0;
    const block = el("section", "snap-case");
    const head = el("div", "snap-case-head"); head.append(el("strong", "", `Season ${s.season}`), tag(resolved ? "Resolved" : "Review", resolved ? "good" : "warn"));
    block.append(head, el("p", "", `${s.indexed}/${s.total} indexed · ${s.queue_records} queue records`),
      el("small", "", `Rechecked ${stamp(s.rerun_at)}`));
    wrap.append(block);
  }
  const s = m.manifest;
  const block = el("section", "snap-case");
  const head = el("div", "snap-case-head"); head.append(el("strong", "", "Season 18"), tag(`${s.unfillable_count} outside manifest`, s.unfillable_count ? "warn" : "good"));
  block.append(head, el("p", "", `Library gaps · ${s.gap_episodes || "None"}`),
    el("p", "", `Transfer lists · ${s.manifest_episodes}`),
    el("p", "snap-emphasis", s.unfillable_count ? `This transfer cannot fill ${s.unfillable_episodes}.` : "This transfer lists every gap."),
    el("small", "", `Manifest checked ${stamp(s.checked_at)}`));
  if (m.explanation) {
    const ai = m.explanation;
    const section = el("section", "snap-explanation");
    section.setAttribute("aria-label", "OpenAI explanation for season 18");
    section.append(el("h5", "", "OpenAI explanation"), privateText(el("p", "", ai.summary)),
      el("h5", "", "Suggested manual follow-up"), privateText(el("p", "", ai.nextStep)),
      el("small", "", `Based on Sonarr queue, Sonarr library and qBittorrent manifest · ${ai.model} · Generated ${stamp(ai.generatedAt)}`));
    block.append(section);
    wrap.insertBefore(block, wrap.querySelector(".snap-case"));
  } else {
    wrap.append(block);
  }
  return wrap;
}

function coverage(m: Snapshot): string {
  return `${m.transfers.length} flagged transfers have saved detail. ${m.omitted} of ${m.total} queue transfers have no saved row detail.`;
}

const missing = () => el("p", "module-error", "Saved snapshot unavailable. Provide a valid local Sonarr snapshot to view transfers.");

export const sonarrSnapshotModule: ModuleManifest<Snapshot | null> = {
  id: "sonarr-snapshot", title: "Sonarr transfers", version: "1.0.0",
  description: "Saved RackMain1 transfer progress, episode coverage and verified season gaps.",
  sources: [
    { id: "sonarr-snapshot", url: "/sonarr-snapshot-data/current.json", optional: true },
    { id: "sonarr-explanation", url: "/sonarr-snapshot-data/s18-explanation.json", optional: true },
  ],
  model: ctx => parseSnapshot(ctx.sources["sonarr-snapshot"]?.data, ctx.mode === "live" ? ctx.sources["sonarr-explanation"]?.data : undefined),
  chip: m => ({ label: m ? "SAVED SNAPSHOT" : "UNAVAILABLE", tone: m ? "info" : "warn" }),
  priority: m => ({ rank: 1, kicker: "RACK STEWARD", title: m ? "Saved Sonarr queue" : "Snapshot unavailable",
    summary: m ? `Observed ${stamp(m.observedAt)}` : "Local snapshot could not be read", posture: "READ ONLY", tone: m ? "info" : "warn" }),
  render(body, m) {
    if (!m) { body.replaceChildren(missing()); return; }
    const metrics = tileRow([
      tile("Flagged transfers", m.transfers.length, "warn"),
      tile("Queue warnings", m.warnings),
      tile("Library gaps", m.gaps, "warn"),
      tile("Total transfers", m.total),
    ], 4);
    const grid = el("div", "snap-grid"); grid.append(roster(m), evidence(m));
    const foot = el("div", "snap-foot");
    foot.append(el("span", "", coverage(m)));
    const open = el("button", "btn", "Open detail"); open.type = "button";
    open.addEventListener("click", e => { e.stopPropagation(); body.closest("article")?.click(); });
    foot.append(open);
    replaceKeepingScroll(body, metrics, grid, foot);
  },
  detail(m) {
    if (!m) return { title: "Sonarr transfers", columns: "1fr", rows: "1fr", sections: [sec(null, missing())] };
    return { title: "Sonarr transfers", chip: { label: "SAVED SNAPSHOT", tone: "info" },
      columns: "minmax(0, 3fr) minmax(0, 1fr)", rows: "minmax(0, 1fr)",
      foot: `${coverage(m)} Observed ${stamp(m.observedAt)}.`,
      sections: [sec("Transfer detail", roster(m)), sec(null, evidence(m))] };
  },
};
