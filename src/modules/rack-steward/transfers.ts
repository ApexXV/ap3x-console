import { el, privateText, tag } from "../../core/dom";
import { record } from "../../core/format";

interface EpisodeGroup { series: string; expected: string; missing: string | null }
interface Transfer {
  id: string;
  name: string;
  state: "stalled" | "error";
  raw_state: string;
  progress_pct: number | null;
  remaining_bytes: number | null;
  match: "matched" | "unmatched" | "unknown";
  episode_coverage: "verified" | "partial" | "unknown";
  episodes: EpisodeGroup[];
}
export interface TransferDetail {
  observed_at: string | null;
  client_status: "ok" | "stale" | "unavailable";
  sonarr_status: "ok" | "partial" | "stale" | "unavailable";
  rows: Transfer[];
}
const bounded = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;
const zeroOrMore = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function group(value: unknown): value is EpisodeGroup {
  return record(value) && bounded(value.series, 140) && typeof value.expected === "string" && value.expected.length <= 4096
    && (value.missing === null || typeof value.missing === "string" && value.missing.length <= 4096);
}

function row(value: unknown): value is Transfer {
  return record(value) && typeof value.id === "string" && /^t-[a-f0-9]{16}$/.test(value.id) && bounded(value.name, 160)
    && (value.state === "stalled" || value.state === "error") && bounded(value.raw_state, 40)
    && (value.progress_pct === null || typeof value.progress_pct === "number" && value.progress_pct >= 0 && value.progress_pct <= 100)
    && (value.remaining_bytes === null || zeroOrMore(value.remaining_bytes))
    && (value.match === "matched" || value.match === "unmatched" || value.match === "unknown")
    && (value.episode_coverage === "verified" || value.episode_coverage === "partial" || value.episode_coverage === "unknown")
    && Array.isArray(value.episodes) && value.episodes.length <= 128 && value.episodes.every(group)
    && (value.match === "matched" || value.episodes.length === 0)
    && (value.episode_coverage !== "verified" || value.match === "matched" && value.episodes.length > 0
      && value.episodes.every(episode => episode.expected.length > 0 && episode.missing !== null));
}

/** An invalid optional block must not hide host/backup findings or imply zero transfers. */
export function parseTransfers(value: unknown): TransferDetail | null {
  if (value === undefined) return null;
  if (record(value) && value.schema_version === 1
      && (value.client_status === "ok" || value.client_status === "stale" || value.client_status === "unavailable")
      && (value.sonarr_status === "ok" || value.sonarr_status === "partial" || value.sonarr_status === "stale" || value.sonarr_status === "unavailable")
      && (value.observed_at === null && value.client_status === "unavailable"
        || typeof value.observed_at === "string" && /(?:Z|\+00:00)$/.test(value.observed_at) && Number.isFinite(Date.parse(value.observed_at)))
      && Array.isArray(value.rows) && value.rows.length <= 4096 && value.rows.every(row)
      && new Set(value.rows.map(item => item.id)).size === value.rows.length
      && (value.client_status !== "unavailable" || value.rows.length === 0)) {
    return { observed_at: value.observed_at, client_status: value.client_status, sonarr_status: value.sonarr_status, rows: value.rows };
  }
  return { observed_at: null, client_status: "unavailable", sonarr_status: "unavailable", rows: [] };
}

function progress(row: Transfer): string {
  const parts: string[] = [];
  if (row.progress_pct !== null) parts.push(`${row.progress_pct}%`);
  if (row.remaining_bytes !== null) {
    const n = row.remaining_bytes;
    const remaining = n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB`
      : n >= 1e3 ? `${(n / 1e3).toFixed(0)} kB` : `${n} B`;
    parts.push(`${remaining} left`);
  }
  return parts.join(" · ");
}

export function transferCounts(detail: TransferDetail): string {
  const stalled = detail.rows.filter(r => r.state === "stalled").length;
  return `${stalled} stalled · ${detail.rows.length - stalled} errored`;
}

const stateLabel = (row: Transfer) => row.raw_state === "missingFiles" ? "Error · Missing files" : row.state === "error" ? "Error"
  : row.raw_state === "stalledUP" ? "Stalled upload" : row.raw_state === "stalledDL" ? "Stalled download" : "Stalled";

/** Prefer an example where Sonarr actually verified which queued episodes lack an indexed file. */
export function transferPreview(detail: TransferDetail): HTMLElement | null {
  const rows = detail.rows;
  const hasGaps = (r: Transfer) => r.episode_coverage === "verified" && r.episodes.some(ep => ep.missing);
  const row = rows.find(r => r.state === "error" && hasGaps(r)) ?? rows.find(hasGaps)
    ?? rows.find(r => r.state === "error") ?? rows[0];
  if (!row) return null;
  const preview = el("div", "media-transfer-example");
  const name = privateText(el("b", "", row.name));
  name.title = row.name;
  preview.append(tag(stateLabel(row), row.state === "error" ? "bad" : "warn"), name);
  const ep = row.episodes.find(series => series.missing);
  if (ep?.missing) {
    preview.append(el("span", "", `Missing · ${ep.missing}`), privateText(el("small", "", ep.series)));
  } else {
    preview.append(el("span", "", row.match === "unmatched" ? "No Sonarr queue match"
      : row.episode_coverage === "verified" ? "No missing episodes" : "Library status unknown"));
  }
  return preview;
}

function transferRow(row: Transfer): HTMLTableRowElement {
  const tr = el("tr");
  tr.dataset.transferId = row.id;
  const name = el("th"); name.scope = "row";
  name.append(privateText(el("b", "", row.name)), el("small", "rack-ref", row.id));
  const client = el("td");
  client.append(tag(stateLabel(row), row.state === "error" ? "bad" : "warn"));
  const stats = progress(row);
  if (stats) client.append(el("small", "", stats));
  const library = el("td", "rack-library");
  for (const episode of row.episodes) {
    const block = el("div");
    const gaps = episode.missing === null ? "Library status unknown"
      : episode.missing || (row.episode_coverage === "verified" ? "No missing episodes" : "No gaps among checked episodes");
    block.append(privateText(el("b", "", episode.series)), el("span", "", gaps));
    if (episode.expected) block.append(el("small", "", `Queued · ${episode.expected}`));
    library.append(block);
  }
  if (!row.episodes.length) library.append(el("span", "rack-muted", row.match === "unmatched" ? "No Sonarr queue match"
    : row.match === "unknown" ? "Sonarr match unknown" : "Library status unknown"));
  if (row.episode_coverage === "partial") library.append(el("small", "", "Partial episode coverage"));
  tr.append(name, client, library);
  return tr;
}

export function transferTable(rows: Transfer[]): HTMLTableElement {
  const table = el("table", "rack-transfer-table");
  table.setAttribute("aria-label", "Stalled and errored transfers");
  const header = table.createTHead().insertRow();
  for (const label of ["Transfer", "qBittorrent", "Missing in Sonarr"]) {
    const th = el("th", "", label); th.scope = "col"; header.append(th);
  }
  const body = table.createTBody();
  const sorted = [...rows].sort((a, b) => Number(b.state === "error") - Number(a.state === "error")
    || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  for (const row of sorted) body.append(transferRow(row));
  return table;
}
