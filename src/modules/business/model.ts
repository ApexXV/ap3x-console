import { asDict, daysUntil, num, record, rows, text } from "../../core/format";
import type { ModuleContext, RunMode, SourceSpec } from "../../core/types";
import { type BusinessSummary, summarizeBusiness, todayEastern } from "./summaries";

/* The business column's shared model: the four validated summaries plus the few details the
 * panels draw (daily bank rows, open obligations, the latest receipt's split). */

export const BUSINESS_SOURCES: SourceSpec[] = [
  { id: "business-record", url: "/business-data/current.json", optional: true },
  { id: "ledger", url: "/deductions-data/current.json", optional: true },
  { id: "ledger-activity", url: "/deductions-data/activity.json", optional: true },
  { id: "bank", url: "/api/wall/business-banking", optional: true },
];

export interface Day { date: string; moneyIn: number; moneyOut: number; net: number; count: number }
export interface Obligation { title: string; owner: string | null; due: string | null; days: number | null; priority: number }
export interface AllocationPart { label: string; color: string; value: number }
export interface Allocation { amount: number | null; date: string | null; parts: AllocationPart[] | null }
export interface Week { start: string; moneyIn: number; moneyOut: number; net: number; count: number; days: number }

export interface BusinessModel extends BusinessSummary {
  mode: RunMode;
  now: number;
  daily: Day[];
  obligations: Obligation[];
  allocation: Allocation | null;
  receiptsExtra: { recordedSince: string | null; latestAmount: number | null; latestDate: string | null; latestStatus: string | null } | null;
}

export const ALLOCATION_ROWS: [key: string, label: string, color: string][] = [
  ["tax_reserved", "TAX RESERVE", "#38bdca"],
  ["card_payments", "CARD PAYMENTS", "#087e91"],
  ["car_reserve", "CAR RESERVE", "#5fe0a6"],
  ["other", "OTHER", "#93acb9"],
  ["unallocated", "UNALLOCATED", "#f2b54f"],
];

export const REVIEW_ROWS = [
  ["missingReceipts", "MISSING RECEIPTS"],
  ["classificationGaps", "CLASSIFICATION GAPS"],
  ["incompleteMileage", "INCOMPLETE MILEAGE"],
  ["assetsAwaitingReview", "ASSETS TO REVIEW"],
  ["appWorkflowExceptions", "WORKFLOW EXCEPTIONS"],
] as const;

export const visible = (state: string): boolean => state === "live" || state === "stale";

function obligationsFrom(business: unknown, now: number): Obligation[] {
  return rows(asDict(business).deadlines)
    .filter((row) => row.active !== false && row.complete !== true)
    .map((row) => {
      const due = typeof row.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.due) ? row.due : null;
      return {
        title: (text(row.short_label, row.label) ?? "Business obligation").slice(0, 90),
        owner: text(row.owner, row.owner_name, row.responsible)?.slice(0, 48) ?? null,
        due, days: daysUntil(due, now), priority: num(row.priority) ?? 0,
      };
    })
    .sort((a, b) => (a.due === null ? 1 : b.due === null ? -1 : a.due.localeCompare(b.due)) || b.priority - a.priority);
}

function dailyFrom(bank: unknown): Day[] {
  return rows(asDict(asDict(bank).activity).daily).map((row) => ({
    date: text(row.date) ?? "", moneyIn: num(row.money_in) ?? 0, moneyOut: num(row.money_out) ?? 0,
    net: num(row.net) ?? 0, count: num(row.transaction_count) ?? 0,
  })).filter((row) => row.date);
}

function allocationFrom(activity: unknown, receiptsState: string): Allocation | null {
  if (!visible(receiptsState)) return null;
  const latest = asDict(asDict(activity).latest);
  const allocation = latest.allocations;
  if (!record(allocation)) return latest.amount ? { amount: num(latest.amount), date: text(latest.received_on), parts: null } : null;
  return {
    amount: num(latest.amount), date: text(allocation.confirmed_on, latest.received_on),
    parts: ALLOCATION_ROWS.map(([key, label, color]) => ({ label, color, value: num(allocation[key]) ?? 0 })),
  };
}

export function businessModel(ctx: ModuleContext): BusinessModel {
  const data = (id: string) => ctx.sources[id]?.data;
  const summary = summarizeBusiness({ business: data("business-record"), ledger: data("ledger"), ledgerActivity: data("ledger-activity"), bank: data("bank") }, ctx.now);
  const activity = asDict(data("ledger-activity"));
  const latest = asDict(activity.latest);
  const model: BusinessModel = {
    ...summary,
    mode: ctx.mode,
    now: ctx.now,
    daily: visible(summary.bank.state) ? dailyFrom(data("bank")) : [],
    obligations: summary.current.state === "live" ? obligationsFrom(data("business-record"), ctx.now) : [],
    allocation: allocationFrom(activity, summary.receipts.state),
    receiptsExtra: visible(summary.receipts.state) ? {
      recordedSince: text(asDict(activity.income).recorded_since), latestAmount: num(latest.amount),
      latestDate: text(latest.received_on), latestStatus: text(latest.deposit_status)?.toUpperCase() ?? null,
    } : null,
  };
  recordBusinessDay(model); // every refresh, not only when the detail is open
  return model;
}

/** Monday-based week key for a YYYY-MM-DD date. */
export function weekStart(date: string): string {
  const t = Date.parse(`${date}T12:00:00Z`);
  const weekday = (new Date(t).getUTCDay() + 6) % 7;
  return new Date(t - weekday * 86_400_000).toISOString().slice(0, 10);
}

/* ---------------- tracked days: one snapshot per day, shared with the old wall ---------------- */

/* Same key and shape as Command 57's wall, which is served from the same origin, so the history
 * the wall built up carries over (and both keep adding to it while both run). */
export const BIZ_DAYS_KEY = "c57-biz-days";
export interface DaySnapshot { gross: number | null; receipts: number | null; review: number | null; open: number | null }
export interface TrackedWeek { start: string; grossAdded: number | null; receiptsAdded: number | null; reviewEnd: number | null; openEnd: number | null; days: number; partialStart: boolean }

let bizDays: Record<string, DaySnapshot> | null = null;
let bizMode: RunMode | null = null;

function storageOf(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

function loadDays(storage: Storage | null): Record<string, DaySnapshot> {
  try {
    const saved = asDict(JSON.parse(storage?.getItem(BIZ_DAYS_KEY) ?? "{}"));
    return Object.fromEntries(Object.entries(saved).filter(([date, v]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && record(v)).map(([date, v]) => {
      const d = v as Record<string, unknown>;
      return [date, { gross: num(d.gross), receipts: num(d.receipts), review: num(d.review), open: num(d.open) }];
    }));
  } catch { return {}; }
}

/** Record today's numbers (live) or a made-up 8-week history (demo); returns every tracked day. */
export function recordBusinessDay(m: BusinessModel, storage: Storage | null = storageOf()): Record<string, DaySnapshot> {
  if (bizDays === null || bizMode !== m.mode) { bizDays = m.mode === "demo" ? {} : loadDays(storage); bizMode = m.mode; }
  if (m.mode === "demo") {
    if (Object.keys(bizDays).length) return bizDays;
    const today = Date.parse(`${todayEastern(m.now)}T12:00:00Z`);
    for (let i = 55; i >= 0; i -= 1) {
      const date = new Date(today - i * 86_400_000).toISOString().slice(0, 10);
      bizDays[date] = { gross: 12_000 + (55 - i) * 118, receipts: 25 + Math.floor((55 - i) / 4.6), review: 4 + ((i * 7) % 9), open: 5 + (i % 3) };
    }
    return bizDays;
  }
  const ok = (state: string) => state === "live" || state === "stale";
  const snapshot: DaySnapshot = {
    gross: ok(m.receipts.state) ? m.receipts.grossReceived : null,
    receipts: ok(m.receipts.state) ? m.receipts.receiptCount : null,
    review: ok(m.review.state) ? m.review.totalOpen : null,
    open: m.current.state === "live" ? m.obligations.length : null,
  };
  if (Object.values(snapshot).every((v) => v === null)) return bizDays;
  const today = todayEastern(m.now);
  if (JSON.stringify(bizDays[today]) === JSON.stringify(snapshot)) return bizDays;
  bizDays = { ...loadDays(storage), [today]: snapshot }; // re-read first: the old wall may have written meanwhile
  const keep = Object.keys(bizDays).sort().slice(-120);
  bizDays = Object.fromEntries(keep.map((k) => [k, bizDays![k]!]));
  try { storage?.setItem(BIZ_DAYS_KEY, JSON.stringify(bizDays)); } catch { /* optional */ }
  return bizDays;
}

/** Per-week deltas from the daily snapshots: receipts added, review queue and open obligations at week end. */
export function trackedWeeks(days: Record<string, DaySnapshot>): TrackedWeek[] {
  const byWeek = new Map<string, [string, DaySnapshot][]>();
  for (const date of Object.keys(days).sort()) {
    const key = weekStart(date);
    byWeek.set(key, [...(byWeek.get(key) ?? []), [date, days[date]!]]);
  }
  let previousEnd: DaySnapshot | null = null;
  const weeks: TrackedWeek[] = [];
  for (const [start, list] of [...byWeek].sort(([x], [y]) => x.localeCompare(y))) {
    const end = list[list.length - 1]![1];
    const base: DaySnapshot = previousEnd ?? list[0]![1];
    weeks.push({
      start,
      grossAdded: end.gross !== null && base.gross !== null ? end.gross - base.gross : null,
      receiptsAdded: end.receipts !== null && base.receipts !== null ? end.receipts - base.receipts : null,
      reviewEnd: end.review, openEnd: end.open, days: list.length, partialStart: previousEnd === null,
    });
    previousEnd = end;
  }
  return weeks;
}

/** Tests only: forget the in-memory history. */
export function resetTrackedDays(): void { bizDays = null; bizMode = null; }

export function weeksFromDaily(daily: Day[]): Week[] {
  const weeks = new Map<string, Week>();
  for (const d of daily) {
    const key = weekStart(d.date);
    const w = weeks.get(key) ?? { start: key, moneyIn: 0, moneyOut: 0, net: 0, count: 0, days: 0 };
    w.moneyIn += d.moneyIn; w.moneyOut += d.moneyOut; w.net += d.net; w.count += d.count; w.days += 1;
    weeks.set(key, w);
  }
  return [...weeks.values()].sort((x, y) => x.start.localeCompare(y.start));
}

/* ---------------- demo payloads: made-up figures in the exact feed contracts ---------------- */

export function demoBusiness(now: number): Record<string, unknown> {
  const stamp = new Date(Math.floor((now - 60_000) / 1000) * 1000).toISOString().replace(".000Z", "Z");
  const revision = stamp.slice(0, 19).replace(/[-:]/g, "") + "Z";
  const today = todayEastern(now);
  const shift = (days: number) => new Date(Date.parse(`${today}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const daily = Array.from({ length: 30 }, (_, i) => {
    const moneyIn = i % 6 === 2 ? 2_400 + (i % 4) * 310 : i % 3 === 0 ? 180 + i * 7 : 0;
    const moneyOut = 90 + ((i * 53) % 260) + (i % 9 === 4 ? 1_150 : 0);
    return { date: shift(i - 29), money_in: moneyIn.toFixed(2), money_out: moneyOut.toFixed(2), net: (moneyIn - moneyOut).toFixed(2), transaction_count: 1 + (i % 4) };
  });
  const sum = (key: "money_in" | "money_out") => daily.reduce((s, d) => s + Number(d[key]), 0);
  const moneyIn = sum("money_in"), moneyOut = sum("money_out");
  return {
    "business-record": {
      protocol: "ap3x.business-ops.v1", schema_version: 2, updated_at: stamp,
      deadlines: [
        { active: true, complete: false, due: shift(-2), short_label: "Q3 sales tax filing", owner: "Owner", priority: 3 },
        { active: true, complete: false, due: shift(4), short_label: "Renew business insurance", owner: "Owner", priority: 2 },
        { active: true, complete: false, due: shift(12), short_label: "Quarterly estimated tax", owner: "Accountant", priority: 3 },
        { active: true, complete: false, due: shift(38), short_label: "Annual report filing", owner: "Owner", priority: 1 },
        { active: true, complete: false, due: null, short_label: "Review vendor contracts", owner: null },
      ],
    },
    ledger: {
      protocol: "ap3x.deductions-wall.v2", schema_version: 2, revision: `DLW003-${revision}`, generated_at: stamp,
      source: { workbook: "AP3X Operations LLC 2026 Deductions Ledger", tax_year: 2026, bookkeeping_basis: "Cash basis", timezone: "America/New_York" },
      privacy: { sanitized_summary_only: true, transaction_details: false, receipt_links: false, identifiers: false },
      review: { missing_receipts: 4, incomplete_mileage: 1, classification_gaps: 3, assets_awaiting_review: 1, app_workflow_exceptions: 0, total_open: 9 },
    },
    "ledger-activity": {
      protocol: "ap3x.ledger-activity.v1", schema: 1, status: "ready", revision: `LFA001-${revision}`, generated_at: stamp,
      source: "cash_inflow_ledger", currency: "USD", year: 2026, included_in_bank_totals: false,
      income: { gross_received: 18_420.5, receipt_count: 37, recorded_since: "2026-01-06", as_of: shift(-2), deposited: 15_980.5, undeposited: 1_840, deposit_unknown: 600 },
      latest: { received_on: shift(-2), amount: 1_250, deposit_status: "undeposited", allocations: {
        tax_reserved: 375, card_payments: 420, car_reserve: 150, other: 105, pending_payments: 200, allocated: 1_050, unallocated: 200, confirmed_on: shift(-1),
      } },
    },
    bank: {
      connection_status: "connected", sync_status: "ok", error: false, last_successful_sync: stamp,
      activity: {
        protocol: "ap3x.business-activity.v1", schema: 1, status: "ready", currency: "USD", as_of: stamp,
        month: { start: shift(-29), end: today, money_in: moneyIn.toFixed(2), money_out: moneyOut.toFixed(2), net: (moneyIn - moneyOut).toFixed(2),
          transaction_count: daily.reduce((s, d) => s + d.transaction_count, 0) },
        daily,
      },
    },
  };
}
