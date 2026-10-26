/* Business summaries: a line-for-line TypeScript port of the business half of
 * ApexXV/ap3x-kiosk-displays ucs-layout-v2-data.js, so the console accepts and rejects
 * exactly what Command 57 does. Each source is validated strictly; anything that fails
 * becomes "unknown" (shown as unavailable), never zero. Only sanitized totals come out. */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

export type SourceState = "live" | "stale" | "partial" | "unknown";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const REVIEW_KEYS = ["missing_receipts", "incomplete_mileage", "classification_gaps", "assets_awaiting_review", "app_workflow_exceptions"];
const record = (value: unknown): value is Record<string, Json> => value !== null && typeof value === "object" && !Array.isArray(value);
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) < 1e9;
const finite = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const amount = (value: unknown): value is number => finite(value) !== null && (value as number) >= 0 && (value as number) < 1e9 &&
  Math.abs((value as number) * 100 - Math.round((value as number) * 100)) < 0.0001;
const cents = (value: unknown): number | null => (amount(value) ? Math.round(value * 100) : null);
const exact = (value: unknown, fields: string[]): value is Record<string, Json> => record(value) &&
  Object.keys(value).sort().join("|") === [...fields].sort().join("|");

function timestamp(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function day(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value ? value : null;
}

function freshness(stamp: unknown, maxAgeMs: number, nowMs: number): "live" | "stale" | "unknown" {
  const then = timestamp(stamp);
  if (then === null || then > nowMs + 5 * MINUTE) return "unknown";
  return nowMs - then > maxAgeMs ? "stale" : "live";
}

export function todayEastern(nowMs: number): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(nowMs));
  const pick = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

export function dayDistance(due: string, today: string): number {
  return Math.round((Date.parse(`${due}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / DAY);
}

export interface Current {
  state: SourceState; updatedAt: string | null; openDeadlines: number | null; sourceAgeMs: number | null;
  overdue: number | null; dueSoon: number | null; nextDue: string | null; nextDueDays: number | null;
}

export function summarizeBusinessCurrent(business: Json, nowMs: number): Current {
  const empty: Current = { state: "unknown", updatedAt: null, openDeadlines: null, sourceAgeMs: null, overdue: null, dueSoon: null, nextDue: null, nextDueDays: null };
  if (!record(business) || business.protocol !== "ap3x.business-ops.v1" || business.schema_version !== 2 || !Array.isArray(business.deadlines)) return empty;
  // This source changes when the owner edits the business record. An old updated_at is
  // useful context, not proof that its obligations expired.
  const updated = timestamp(business.updated_at);
  if (updated === null || updated > nowMs + 5 * MINUTE) return empty;
  const today = todayEastern(nowMs);
  const active = business.deadlines.filter((item: Json) => record(item) && item.active !== false && item.complete !== true);
  const dated = active.map((item: Json) => day(item.due)).filter(Boolean) as string[];
  const offsets = dated.map((value) => dayDistance(value, today));
  const nextDue = dated.sort()[0] || null;
  return {
    state: "live", updatedAt: business.updated_at, sourceAgeMs: Math.max(0, nowMs - updated), openDeadlines: active.length,
    overdue: offsets.filter((value) => value < 0).length,
    dueSoon: offsets.filter((value) => value >= 0 && value <= 30).length,
    nextDue, nextDueDays: nextDue === null ? null : dayDistance(nextDue, today),
  };
}

export interface Review {
  state: SourceState; generatedAt: string | null; totalOpen: number | null; missingReceipts: number | null; incompleteMileage: number | null;
  classificationGaps: number | null; assetsAwaitingReview: number | null; appWorkflowExceptions: number | null;
}

export function summarizeReview(ledger: Json, nowMs: number): Review {
  const empty: Review = { state: "unknown", generatedAt: null, totalOpen: null, missingReceipts: null, incompleteMileage: null,
    classificationGaps: null, assetsAwaitingReview: null, appWorkflowExceptions: null };
  if (!record(ledger) || ledger.protocol !== "ap3x.deductions-wall.v2" || ledger.schema_version !== 2 ||
      !/^DLW003-\d{8}T\d{6}Z$/.test(ledger.revision || "") ||
      ledger.source?.workbook !== "AP3X Operations LLC 2026 Deductions Ledger" || ledger.source?.tax_year !== 2026 ||
      ledger.source?.bookkeeping_basis !== "Cash basis" || ledger.source?.timezone !== "America/New_York" ||
      !record(ledger.privacy) || ledger.privacy.sanitized_summary_only !== true || ledger.privacy.transaction_details !== false ||
      ledger.privacy.receipt_links !== false || ledger.privacy.identifiers !== false ||
      !exact(ledger.review, [...REVIEW_KEYS, "total_open"])) return empty;
  const state = freshness(ledger.generated_at, 60 * MINUTE, nowMs);
  if (state === "unknown") return empty;
  const revisionStamp = new Date(timestamp(ledger.generated_at)!).toISOString().slice(0, 19).replace(/[-:]/g, "") + "Z";
  if (ledger.revision !== `DLW003-${revisionStamp}` || !REVIEW_KEYS.every((key) => count(ledger.review[key])) ||
      !count(ledger.review.total_open) ||
      REVIEW_KEYS.reduce((sum, key) => sum + ledger.review[key], 0) !== ledger.review.total_open) return empty;
  return {
    state, generatedAt: ledger.generated_at, totalOpen: ledger.review.total_open,
    missingReceipts: ledger.review.missing_receipts, incompleteMileage: ledger.review.incomplete_mileage,
    classificationGaps: ledger.review.classification_gaps, assetsAwaitingReview: ledger.review.assets_awaiting_review,
    appWorkflowExceptions: ledger.review.app_workflow_exceptions,
  };
}

export interface Receipts {
  state: SourceState; generatedAt: string | null; grossReceived: number | null; receiptCount: number | null; deposited: number | null;
  undeposited: number | null; depositUnknown: number | null; asOf: string | null; source: string; includedInBankTotals: false;
}

export function summarizeReceipts(activity: Json, nowMs: number): Receipts {
  const empty: Receipts = { state: "unknown", generatedAt: null, grossReceived: null, receiptCount: null, deposited: null,
    undeposited: null, depositUnknown: null, asOf: null, source: "Cash Inflow ledger", includedInBankTotals: false };
  if (!exact(activity, ["protocol", "schema", "status", "revision", "generated_at", "source", "currency", "year", "included_in_bank_totals", "income", "latest"]) ||
      activity.protocol !== "ap3x.ledger-activity.v1" || activity.schema !== 1 || activity.status !== "ready" ||
      activity.source !== "cash_inflow_ledger" || activity.currency !== "USD" || activity.included_in_bank_totals !== false ||
      activity.year !== 2026 || !/^LFA001-\d{8}T\d{6}Z$/.test(activity.revision || "")) return empty;
  const state = freshness(activity.generated_at, 15 * MINUTE, nowMs);
  if (state === "unknown") return empty;
  const revisionStamp = new Date(timestamp(activity.generated_at)!).toISOString().slice(0, 19).replace(/[-:]/g, "") + "Z";
  const income = activity.income;
  if (activity.revision !== `LFA001-${revisionStamp}` ||
      !exact(income, ["gross_received", "receipt_count", "recorded_since", "as_of", "deposited", "undeposited", "deposit_unknown"]) ||
      !count(income.receipt_count) || income.receipt_count > 1e6) return empty;
  const gross = cents(income.gross_received);
  const deposited = cents(income.deposited);
  const undeposited = cents(income.undeposited);
  const unknown = cents(income.deposit_unknown);
  if ([gross, deposited, undeposited, unknown].some((value) => value === null) || gross !== deposited! + undeposited! + unknown!) return empty;
  if (income.receipt_count === 0) {
    if (gross !== 0 || income.recorded_since !== null || income.as_of !== null || activity.latest !== null) return empty;
  } else {
    const latest = activity.latest;
    const generatedDay = todayEastern(timestamp(activity.generated_at)!);
    if (gross === 0 || !day(income.recorded_since) || !day(income.as_of) || income.recorded_since > income.as_of || income.as_of > generatedDay ||
        !exact(latest, ["received_on", "amount", "deposit_status", "allocations"]) || latest.received_on !== income.as_of ||
        !amount(latest.amount) || latest.amount === 0 || !["deposited", "undeposited", "unknown"].includes(latest.deposit_status) ||
        cents(latest.amount)! > cents(income[({ deposited: "deposited", undeposited: "undeposited", unknown: "deposit_unknown" } as Record<string, string>)[latest.deposit_status]!])!) return empty;
    const allocation = latest.allocations;
    if (allocation !== null) {
      const fields = ["tax_reserved", "card_payments", "car_reserve", "other", "pending_payments", "allocated", "unallocated", "confirmed_on"];
      if (!exact(allocation, fields) || !fields.slice(0, -1).every((key) => amount(allocation[key])) || !day(allocation.confirmed_on) ||
          allocation.confirmed_on < latest.received_on || allocation.confirmed_on > generatedDay ||
          ["tax_reserved", "card_payments", "car_reserve", "other"].reduce((sum, key) => sum + cents(allocation[key])!, 0) !== cents(allocation.allocated) ||
          cents(allocation.allocated)! + cents(allocation.unallocated)! !== cents(latest.amount) ||
          cents(allocation.pending_payments)! > cents(allocation.card_payments)!) return empty;
    }
  }
  return {
    state, generatedAt: activity.generated_at, grossReceived: income.gross_received, receiptCount: income.receipt_count,
    deposited: income.deposited, undeposited: income.undeposited, depositUnknown: income.deposit_unknown, asOf: income.as_of,
    source: "Cash Inflow ledger", includedInBankTotals: false,
  };
}

export function bankDecimal(value: unknown): number | null {
  return typeof value === "string" && /^-?\d+(?:\.\d{1,8})?$/.test(value) && Number.isFinite(Number(value)) ? Number(value) : null;
}

export interface Bank {
  state: SourceState; connected: boolean | null; asOf: string | null; postedIn: number | null; postedOut: number | null;
  postedNet: number | null; transactionCount: number | null;
}

export function summarizeBank(bank: Json, nowMs: number): Bank {
  const empty: Bank = { state: "unknown", connected: null, asOf: null, postedIn: null, postedOut: null, postedNet: null, transactionCount: null };
  if (!record(bank) || !["connected", "not_connected", "select_accounts", "reconnect_required", "disconnect_pending"].includes(bank.connection_status)) return empty;
  if (bank.connection_status !== "connected") return { ...empty, state: "partial", connected: false };
  const activity = bank.activity;
  const month = activity?.month;
  if (!record(activity) || activity.protocol !== "ap3x.business-activity.v1" || activity.schema !== 1 || !["ready", "cached"].includes(activity.status) ||
      activity.currency !== "USD" || !record(month) || !Array.isArray(activity.daily) || activity.daily.length !== 30 ||
      !day(month.start) || !day(month.end) || !count(month.transaction_count) ||
      !activity.daily.every((row: Json) => record(row) && day(row.date) && count(row.transaction_count) &&
        bankDecimal(row.money_in) !== null && bankDecimal(row.money_out) !== null && bankDecimal(row.net) !== null)) {
    return { ...empty, state: "partial", connected: true };
  }
  const moneyIn = bankDecimal(month.money_in);
  const moneyOut = bankDecimal(month.money_out);
  const net = bankDecimal(month.net);
  if (moneyIn === null || moneyOut === null || net === null || moneyIn < 0 || moneyOut < 0 || Math.abs((moneyIn - moneyOut) - net) > 0.000001) {
    return { ...empty, state: "partial", connected: true };
  }
  const sync = freshness(bank.last_successful_sync, DAY, nowMs);
  const activityState = freshness(activity.as_of, DAY, nowMs);
  const state: SourceState = sync === "unknown" || activityState === "unknown" ? "partial"
    : sync === "stale" || activityState === "stale" || activity.status === "cached" ? "stale"
      : bank.sync_status === "ok" && bank.error !== true ? "live" : "partial";
  return { state, connected: true, asOf: activity.as_of, postedIn: moneyIn, postedOut: moneyOut, postedNet: net, transactionCount: month.transaction_count };
}

export interface BusinessSummary { state: SourceState; current: Current; review: Review; receipts: Receipts; bank: Bank }

export function summarizeBusiness(inputs: { business?: Json; ledger?: Json; ledgerActivity?: Json; bank?: Json }, nowMs: number): BusinessSummary {
  const current = summarizeBusinessCurrent(inputs.business, nowMs);
  const review = summarizeReview(inputs.ledger, nowMs);
  const receipts = summarizeReceipts(inputs.ledgerActivity, nowMs);
  const bank = summarizeBank(inputs.bank, nowMs);
  const views = [current, review, receipts, bank];
  const known = views.filter((view) => view.state !== "unknown");
  const state: SourceState = known.length === 0 ? "unknown"
    : known.length < views.length || known.some((view) => view.state === "partial") ? "partial"
      : known.some((view) => view.state === "stale") ? "stale" : "live";
  return { state, current, review, receipts, bank };
}
