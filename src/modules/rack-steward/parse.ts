import { record } from "../../core/format";
import { parseTransfers, type TransferDetail } from "./transfers";

export const REPORT_MAX_AGE = 35 * 60_000;

export interface Source {
  id: string;
  observed_at: string | null;
  status: "ok" | "stale" | "unavailable";
}

interface Explanation {
  model: string;
  generated_at: string;
  summary: string;
  next_step: string;
}

export interface Issue {
  id: string;
  title: string;
  evidence: Record<string, string | number | boolean>;
  status: "active" | "unconfirmed";
  change: "new" | "changed" | "ongoing";
  explanation: Explanation | null;
}

interface Recovery { id: string; title: string; recovered_at: string }
export interface Report {
  observedAt: string;
  sources: Source[];
  issues: Issue[];
  recovered: Recovery[];
  analysis: { status: "current" | "pending" | "unavailable"; pending: number };
  transfers: TransferDetail | null;
  overdue: boolean;
  retained: boolean;
}

const text = (v: unknown, limit: number): v is string =>
  typeof v === "string" && v.trim().length > 0 && v.length <= limit;
const id = (v: unknown): v is string => text(v, 96) && /^[a-zA-Z0-9_.-]+$/.test(v);
const stamp = (v: unknown): v is string => text(v, 48) && /(?:Z|\+00:00)$/.test(v) && Number.isFinite(Date.parse(v));

function source(v: unknown): v is Source {
  return record(v) && id(v.id) && (v.status === "ok" || v.status === "stale" || v.status === "unavailable")
    && (stamp(v.observed_at) || (v.status !== "ok" && v.observed_at === null));
}

function explanation(v: unknown): v is Explanation {
  return record(v) && text(v.model, 128) && stamp(v.generated_at) && text(v.summary, 600) && text(v.next_step, 320);
}

function issue(v: unknown): v is Issue {
  if (!record(v) || !id(v.id) || !text(v.title, 140) || (v.status !== "active" && v.status !== "unconfirmed")
      || (v.change !== "new" && v.change !== "changed" && v.change !== "ongoing")
      || (v.explanation !== null && !explanation(v.explanation)) || !record(v.evidence)) return false;
  const facts = Object.entries(v.evidence);
  return facts.length <= 24 && facts.every(([k, val]) => text(k, 64)
    && (text(val, 120) || Number.isSafeInteger(val) || typeof val === "boolean"));
}

function recovery(v: unknown): v is Recovery {
  return record(v) && id(v.id) && text(v.title, 140) && stamp(v.recovered_at);
}

function distinct<T extends { id: string }>(rows: unknown, check: (v: unknown) => v is T): rows is T[] {
  return Array.isArray(rows) && rows.length <= 1024 && rows.every(check) && new Set(rows.map(row => row.id)).size === rows.length;
}

export function parseReport(v: unknown, now: number, retained = false): Report | null {
  if (!record(v) || v.schema_version !== 1 || v.kind !== "bbx.scheduled-report" || !stamp(v.observed_at)
      || !distinct(v.sources, source) || !v.sources.length || !distinct(v.issues, issue) || !distinct(v.recovered, recovery)
      || !record(v.analysis) || (v.analysis.status !== "current" && v.analysis.status !== "pending" && v.analysis.status !== "unavailable")
      || typeof v.analysis.pending !== "number" || !Number.isSafeInteger(v.analysis.pending) || v.analysis.pending < 0) return null;
  return { observedAt: v.observed_at, sources: v.sources, issues: v.issues, recovered: v.recovered,
    transfers: parseTransfers(v.transfer_detail),
    analysis: { status: v.analysis.status, pending: v.analysis.pending },
    overdue: now - Date.parse(v.observed_at) > REPORT_MAX_AGE, retained };
}
