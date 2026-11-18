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
  explanation: { model: string; generatedAt: string; summary: string; nextStep: string } | null;
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

const citations = ["sonarr.expected", "sonarr.indexed", "qbit.manifest"];
const prose = (v: unknown, limit: number): v is string => label(v) && v.length <= limit;

function season18Episodes(value: unknown): Set<number> | null {
  if (typeof value !== "string" || value.length > 1024) return null;
  const numbers = new Set<number>();
  if (!value) return numbers;
  for (const part of value.split(",")) {
    const range = /^S18E(\d{1,4})(?:[–-]E(\d{1,4}))?$/.exec(part.trim());
    if (!range) return null;
    const first = Number(range[1]), last = Number(range[2] ?? range[1]);
    if (first < 1 || last < first || numbers.size + last - first + 1 > 1000) return null;
    for (let number = first; number <= last; number++) {
      if (numbers.has(number)) return null;
      numbers.add(number);
    }
  }
  return numbers;
}

function sameEpisodes(label: unknown, expected: Set<number>): boolean {
  const parsed = season18Episodes(label);
  return !!parsed && parsed.size === expected.size && [...parsed].every(n => expected.has(n));
}

/** Reconcile the model's evidence with the saved row and the independent manifest check. */
function matchesArchive(facts: Record<string, unknown>, rows: Transfer[], manifest: ManifestCheck): boolean {
  const expected = season18Episodes(facts.expected), indexed = season18Episodes(facts.indexed);
  const missing = season18Episodes(facts.missing), transfer = season18Episodes(facts.transfer);
  if (!expected?.size || !indexed || !missing?.size || !transfer?.size) return false;
  // The two library sets must partition the expected episodes, and this transfer must lack every gap.
  if (expected.size !== indexed.size + missing.size || [...indexed].some(n => !expected.has(n) || missing.has(n))
      || [...missing].some(n => !expected.has(n) || transfer.has(n))) return false;
  const candidates = rows.filter(row => row.series === "Family Guy" && sameEpisodes(row.episodes, expected));
  const row = candidates[0];
  return candidates.length === 1 && !!row && row.state === "missing_files" && row.warning_records === expected.size
    && row.indexed_episodes === indexed.size && row.gap_count === missing.size && manifest.unfillable_count === missing.size
    && sameEpisodes(row.gap_episodes, missing) && sameEpisodes(row.unfillable_episodes, missing)
    && sameEpisodes(manifest.gap_episodes, missing) && sameEpisodes(manifest.unfillable_episodes, missing)
    && sameEpisodes(manifest.manifest_episodes, transfer);
}

function parseExplanation(data: unknown, observed: string, rows: Transfer[], manifest: ManifestCheck): Snapshot["explanation"] {
  if (!record(data) || data.schema_version !== 1 || data.kind !== "bbx.sonarr-explanation"
      || data.case_id !== "family-guy-s18" || data.observed_at !== observed
      || !date(data.generated_at) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|\+00:00)$/.test(data.generated_at)
      || Date.parse(data.generated_at) < Math.max(Date.parse(observed), Date.parse(manifest.checked_at))
      || !label(data.model) || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(data.model)
      || !label(data.evidence_sha256) || !/^[a-f0-9]{64}$/.test(data.evidence_sha256)
      || !record(data.evidence) || !record(data.explanation)) return null;

  if (!matchesArchive(data.evidence, rows, manifest)) return null;

  const { summary, next_step, evidence_ids } = data.explanation;
  if (!prose(summary, 600) || !prose(next_step, 320) || !Array.isArray(evidence_ids)
      || evidence_ids.length !== citations.length || !citations.every(id => evidence_ids.includes(id))) return null;
  return { model: data.model, generatedAt: data.generated_at, summary, nextStep: next_step };
}

/** Reject partial snapshots so a missing row cannot look like a resolved transfer. */
export function parseSnapshot(data: unknown, explanation?: unknown): Snapshot | null {
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
    gaps: s.library_gaps, resolved, manifest: family.season18,
    explanation: parseExplanation(explanation, data.observed_at, rows, family.season18) };
}
