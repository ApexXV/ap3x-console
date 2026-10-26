/* Finance and market summaries: a line-for-line TypeScript port of summarizeFinance and
 * summarizeMarkets from ApexXV/ap3x-kiosk-displays ucs-layout-v2-data.js. The combined equity is
 * withheld unless all four accounts are present and reconcile with the reported total. */

import { count, finite, freshness, record } from "../business/summaries";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

const MINUTE = 60_000;
export const ACCOUNT_KEYS = ["taxable", "roth_ira", "agentic", "smart_income"] as const;
export type AccountKey = typeof ACCOUNT_KEYS[number];

function financeNumber(value: unknown): number | null {
  if (typeof value === "number") return finite(value);
  if (typeof value !== "string" || value.length > 64 || !/^-?\d+(?:\.\d{1,8})?$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function accountValue(account: Json): number | null {
  if (!record(account)) return null;
  for (const key of ["account_value", "equity", "extended_hours_equity", "market_value"]) {
    const value = financeNumber(account[key]);
    if (value !== null && value >= 0) return value;
  }
  return null;
}

export interface FinanceSummary {
  state: "live" | "stale" | "partial" | "unknown";
  coverage: number | null;
  combinedEquity: number | null;
  accounts: Record<AccountKey, number | null>;
  brokerFresh: boolean | null;
  readerState: string | null;
}

export function summarizeFinance(finance: Json, nowMs: number): FinanceSummary {
  const empty: FinanceSummary = { state: "unknown", coverage: null, combinedEquity: null,
    accounts: Object.fromEntries(ACCOUNT_KEYS.map((key) => [key, null])) as Record<AccountKey, null>, brokerFresh: null, readerState: null };
  if (!record(finance) || !record(finance.accounts) || !record(finance.coverage)) return empty;
  const accounts = Object.fromEntries(ACCOUNT_KEYS.map((key) => [key, accountValue(finance.accounts[key])])) as Record<AccountKey, number | null>;
  const available = ACCOUNT_KEYS.filter((key) => accounts[key] !== null).length;
  const coverage = finance.coverage;
  const reported = [finance.all_accounts_total, finance.combined_equity, finance.combined?.account_value].map(financeNumber).find((value) => value !== null) ?? null;
  const faults = ["missing_accounts", "unexpected_accounts", "duplicate_accounts"].every((key) => Array.isArray(coverage[key]) && coverage[key].length === 0);
  const sum = ACCOUNT_KEYS.reduce((total, key) => total + (accounts[key] ?? 0), 0);
  const complete = available === 4 && coverage.complete === true && coverage.available_account_count === 4 && faults &&
    reported !== null && reported >= 0 && Math.abs(reported - sum) <= 0.05;
  const readerState = typeof finance.reader?.status === "string" ? finance.reader.status : null;
  const broker = record(finance.broker_snapshot) ? finance.broker_snapshot : finance.freshness;
  const brokerFresh = broker?.fresh === true && finance.fresh !== false && (readerState === null || readerState === "RUNNING");
  const observed = finance.reader?.accounts_observed_at;
  const observedState = observed ? freshness(observed, 30 * MINUTE, nowMs) : "unknown";
  const brokerAge = finite(broker?.age_seconds);
  const state = !complete ? "partial" : !brokerFresh || observedState === "stale" || (observedState === "unknown" && brokerAge !== null && brokerAge > 1800) ? "stale"
    : observedState === "unknown" && brokerAge === null ? "partial" : "live";
  return { state, coverage: available, combinedEquity: complete ? reported : null, accounts, brokerFresh, readerState };
}

export interface Quote { price: number; move5mPct: number | null; move15mPct: number | null; freshForTrading: boolean; retained: boolean }
export interface MarketsSummary {
  state: "live" | "stale" | "partial" | "unknown";
  session: "open" | "closed" | "unknown";
  quoteMode: "trading" | "retained" | "unknown";
  quotes: Record<string, Quote>;
  quoteCount?: number | null;
  expectedQuotes?: number | null;
  generatedAt: string | null;
}

export function summarizeMarkets(markets: Json, nowMs: number): MarketsSummary {
  const empty: MarketsSummary = { state: "unknown", session: "unknown", quoteMode: "unknown", quotes: {}, generatedAt: null };
  if (!record(markets) || !record(markets.health) || !record(markets.prices)) return empty;
  const snapshotState = freshness(markets.generated_at, 3 * MINUTE, nowMs);
  if (snapshotState === "unknown") return empty;
  const session = String(markets.session || "").toLowerCase();
  const closed = markets.health.active_trading_session === false &&
    (session === "closed" || String(markets.health.scan_quality || "").toLowerCase().includes("closed"));
  const active = markets.health.active_trading_session === true;
  const quoteMode = closed ? "retained" : active ? "trading" : "unknown";
  const quotes: Record<string, Quote> = {};
  for (const [symbol, quote] of Object.entries(markets.prices as Record<string, Json>).slice(0, 32)) {
    if (!/^[A-Z0-9.\-]{1,12}$/.test(symbol) || !record(quote)) continue;
    const price = finite(quote.price);
    if (price === null || price < 0 || (quote.available !== true && quote.fresh_for_trading !== true)) continue;
    quotes[symbol] = { price, move5mPct: finite(quote.move_5m_pct), move15mPct: finite(quote.move_15m_pct), freshForTrading: quote.fresh_for_trading === true && active, retained: closed };
  }
  const expected = count(markets.health.symbols_expected) ? markets.health.symbols_expected : null;
  const observedValue = active ? markets.health.fresh_quote_count : markets.health.inactive_session_quote_count;
  const observed = count(observedValue) ? observedValue : null;
  const state = markets.health.state_stale === true || snapshotState === "stale" ? "stale"
    : markets.health.scan_complete === false || markets.health.fetch_failure_count > 0 || (expected !== null && (observed === null || observed < expected)) ? "partial" : "live";
  return { state, session: closed ? "closed" : active ? "open" : "unknown", quoteMode, quotes, quoteCount: observed, expectedQuotes: expected, generatedAt: markets.generated_at };
}
