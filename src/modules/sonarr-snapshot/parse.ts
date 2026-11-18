import { record } from "../../core/format";

export interface Transfer {
  id: string; series: string; episodes: string; state: "stalled" | "missing_files";
  progress_pct: number; remaining_bytes: number; warning_records: number; indexed_episodes: number;
  gap_count: number; gap_episodes: string; unfillable_episodes: string | null;
}
export interface Resolution {
  season: number; indexed: number; total: number; queue_records: number;
  verified_at: string; rerun_at: string;
}
export interface ManifestCheck {
  manifest_episodes: string; gap_episodes: string; unfillable_episodes: string;
  unfillable_count: number; checked_at: string;
}
export interface Snapshot {
  observedAt: string; recheckedAt: string; transfers: Transfer[]; total: number; warnings: number;
  gaps: number; omitted: number; resolved: Resolution[]; manifest: ManifestCheck;
}

const count = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const label = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const date = (v: unknown): v is string => label(v) && Number.isFinite(Date.parse(v));

function isTransfer(t: unknown): t is Transfer {
  return record(t) && label(t.id) && label(t.series) && label(t.episodes)
    && (t.state === "stalled" || t.state === "missing_files")
    && typeof t.progress_pct === "number" && t.progress_pct >= 0 && t.progress_pct <= 100
    && count(t.remaining_bytes) && count(t.warning_records) && count(t.indexed_episodes) && count(t.gap_count)
    && typeof t.gap_episodes === "string" && (t.gap_count === 0 || label(t.gap_episodes))
    && (t.unfillable_episodes === null || typeof t.unfillable_episodes === "string");
}
function isResolution(s: unknown): s is Resolution {
  return record(s) && count(s.season) && count(s.indexed) && count(s.total) && s.total > 0 && s.indexed <= s.total
    && count(s.queue_records) && date(s.verified_at) && date(s.rerun_at);
}
function isManifest(s: unknown): s is ManifestCheck {
  return record(s) && label(s.manifest_episodes) && typeof s.gap_episodes === "string"
    && typeof s.unfillable_episodes === "string" && count(s.unfillable_count) && date(s.checked_at);
}

/** Reject partial snapshots so a missing row cannot look like a resolved transfer. */
export function parseSnapshot(data: unknown): Snapshot | null {
  if (!record(data) || data.schema_version !== 1 || data.mode !== "saved_snapshot" || !date(data.observed_at)
      || !date(data.client_rechecked_at) || !record(data.summary) || !Array.isArray(data.rows)
      || !data.rows.every(isTransfer) || !record(data.family_guy)) return null;
  const rows: Transfer[] = data.rows;
  const s = data.summary;
  const family = data.family_guy;
  const resolved = family.resolved;
  if (!count(s.total_transfers) || !count(s.without_transfer_detail) || !count(s.warning_records)
      || !count(s.library_gaps) || s.flagged_transfers !== rows.length
      || rows.length + s.without_transfer_detail !== s.total_transfers || new Set(rows.map(r => r.id)).size !== rows.length
      || rows.reduce((n, r) => n + r.gap_count, 0) !== s.library_gaps
      || rows.reduce((n, r) => n + r.warning_records, 0) !== s.warning_records
      || !Array.isArray(resolved) || !resolved.every(isResolution)
      || resolved.length !== 2 || ![15, 17].every(n => resolved.some(s => s.season === n))
      || !isManifest(family.season18)) return null;
  return { observedAt: data.observed_at, recheckedAt: data.client_rechecked_at, transfers: rows,
    total: s.total_transfers, omitted: s.without_transfer_detail, warnings: s.warning_records,
    gaps: s.library_gaps, resolved, manifest: family.season18 };
}
