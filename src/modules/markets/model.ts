import { asDict, bool, num, pick, record, rows, sinceMs, text, toneFor } from "../../core/format";
import type { ModuleContext, RunMode, SourceSpec } from "../../core/types";
import { parseServices, DEFAULT_SERVICES } from "../services";
import { ACCOUNT_KEYS, type AccountKey, type FinanceSummary, summarizeFinance, summarizeMarkets } from "./summaries";

/* Finance & markets: the four-account portfolio, the Market Sentinel watchlist and score, the
 * Codex capacity meter, and the control & external status tiles. */

export const FINANCE_SOURCE: SourceSpec = { id: "finance", url: "/api/finance/daily", optional: true };
export const SENTINEL_SOURCE: SourceSpec = { id: "sentinel", url: "/api/market/sentinel", optional: true };
export const CAPACITY_SOURCE: SourceSpec = { id: "capacity", url: "/ai-capacity-data/current.json", stampField: "generated_at", maxAgeMs: 60 * 60_000 };
export const CONTROL_SOURCES: SourceSpec[] = [
  { id: "status", url: "/api/status" },
  { id: "ops-brief", url: "/api/ops/brief" },
  { id: "quicksilver", url: "/api/quicksilver/status", optional: true },
  { id: "plex-update", url: "/api/plex/update-state", optional: true },
  { id: "games", url: "/api/games", optional: true },
  { id: "external", url: "/api/external", optional: true },
  { id: "music", url: "/api/music/state", optional: true },
];

export const ACCOUNT_ROWS: [key: AccountKey, label: string, color: string][] = [
  ["taxable", "TAXABLE", "#38bdca"], ["roth_ira", "ROTH IRA", "#087e91"], ["agentic", "AGENTIC", "#5fe0a6"], ["smart_income", "SMART INCOME", "#f5f7f6"],
];

export interface Position {
  symbol: string; qty: number | null; price: number | null; value: number | null; pl: number | null;
  dayPct: number | null; plPct: number | null; accounts: { account: string; qty: number | null; value: number | null }[];
}

export interface FinanceModel extends FinanceSummary {
  mode: RunMode; now: number;
  equity: number | null; dayDollar: number | null; dayPct: number | null;
  weekly: number | null; pendingCount: number | null; pendingTotal: number | null; pendingLanding: string | null;
  lastPull: { amount: number | null; date: string | null } | null;
  brokerAgeMs: number | null; quoteAgeMs: number | null; ledgerAgeMs: number | null;
  positions: Position[];
}

export interface QuoteRow { symbol: string; price: number; m5: number | null; m15: number | null }
export interface Candidate { symbol: string; score: number | null; side: string | null; reason: string | null }
export interface Capacity { state: string; remaining: number | null; detail: string }

export interface MarketsModel {
  mode: RunMode; now: number;
  state: string; session: string; quoteMode: string; quotes: QuoteRow[];
  score: number | null; sentinelState: string; candidates: Candidate[];
  quoteCount: number | null; expectedQuotes: number | null; generatedAt: string | null;
  capacity: Capacity;
}

/* The finance feed may list each holding per account and again as a combined row. Show one row
 * per symbol: the combined total plus where it is held. */
function positionsFrom(finance: unknown): Position[] {
  const fraction = (v: number | null) => (v === null ? null : Math.abs(v) <= 5 ? v * 100 : v);
  const parse = (row: Record<string, unknown>, account: string | null) => {
    const qty = num(row.qty, row.quantity, row.shares);
    const price = num(row.current_price, row.price, row.last_price, row.last);
    const value = num(row.market_value, row.value, row.marketValue, row.equity) ?? (qty !== null && price !== null ? qty * price : null);
    const avg = num(row.avg_entry_price, row.average_price, row.avg_cost);
    const cost = num(row.cost_basis, row.cost) ?? (avg !== null && qty !== null ? avg * qty : null);
    return {
      symbol: text(row.symbol, row.ticker, row.name)?.toUpperCase() ?? null, account, qty, price, value, cost,
      lastday: num(row.lastday_price, row.prev_close, row.previous_close),
      dayPct: num(row.day_change_pct, row.change_today_pct) ?? fraction(num(row.change_today)),
      plPct: num(row.unrealized_pl_pct, row.pl_pct) ?? fraction(num(row.unrealized_plpc)),
      pl: num(row.unrealized_pl, row.pl),
    };
  };
  type Row = ReturnType<typeof parse>;
  const valid = (row: Row) => Boolean(row.symbol && /^[A-Z0-9.\-]{1,12}$/.test(row.symbol));
  const combined = rows(pick(finance, ["combined.positions", "portfolio.positions", "positions"])).map((row) => parse(row, text(row.account, row.account_key))).filter(valid);
  const perAccount = ACCOUNT_KEYS.flatMap((key) => rows(pick(finance, [`accounts.${key}.positions`])).map((row) => parse(row, key)).filter(valid));
  const source = perAccount.length ? perAccount : combined;
  const groups = new Map<string, Row[]>();
  for (const row of source) groups.set(row.symbol!, [...(groups.get(row.symbol!) ?? []), row]);
  const sum = (list: Row[], key: "qty" | "value" | "cost" | "pl") => (list.every((r) => r[key] === null) ? null : list.reduce((s, r) => s + (r[key] ?? 0), 0));
  return [...groups.entries()].map(([symbol, holdings]) => {
    const total = perAccount.length ? combined.find((r) => r.symbol === symbol && !r.account) : undefined;
    const qty = total?.qty ?? sum(holdings, "qty");
    const value = total?.value ?? sum(holdings, "value");
    const price = total?.price ?? holdings.find((r) => r.price !== null)?.price ?? null;
    const cost = total?.cost ?? sum(holdings, "cost");
    const lastday = total?.lastday ?? holdings.find((r) => r.lastday !== null)?.lastday ?? null;
    const pl = total?.pl ?? sum(holdings, "pl") ?? (cost && value !== null ? value - cost : null);
    const single = holdings.length === 1 ? holdings[0] : null;
    return {
      symbol, qty, price, value, pl,
      dayPct: total?.dayPct ?? single?.dayPct ?? (price !== null && lastday ? (price / lastday - 1) * 100 : null),
      plPct: total?.plPct ?? single?.plPct ?? (cost && value !== null ? ((value - cost) / cost) * 100 : null),
      accounts: holdings.filter((r) => r.account).map((r) => ({ account: r.account!, qty: r.qty, value: r.value })).sort((a, b) => (b.value ?? 0) - (a.value ?? 0)),
    };
  }).sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, 40);
}

export function financeModel(ctx: ModuleContext): FinanceModel {
  const raw = ctx.sources.finance?.data;
  const summary = summarizeFinance(raw, ctx.now);
  const contributions = asDict(asDict(raw).roth_contributions);
  const verified = contributions.available === true && contributions.history_complete === true;
  const pending = asDict(contributions.pending);
  const broker = asDict(asDict(raw).broker_snapshot);
  const reader = asDict(asDict(raw).reader);
  const lastPull = asDict(contributions.last_pull);
  const brokerSeconds = num(broker.age_seconds);
  return {
    ...summary, mode: ctx.mode, now: ctx.now,
    equity: summary.combinedEquity,
    dayDollar: num(pick(raw, ["day_change", "daily_change", "combined.day_change"])),
    dayPct: num(pick(raw, ["day_change_pct", "daily_change_pct", "combined.day_change_pct"])),
    weekly: verified ? (Object.keys(lastPull).length ? num(lastPull.amount) : 0) : null,
    pendingCount: verified ? num(pending.count) : null,
    pendingTotal: verified ? num(pending.total) : null,
    /* Robinhood keeps an ACH pull "pending" until it settles, even when the money has left the
     * bank and is usable; show when the earliest one is expected to land. */
    pendingLanding: verified ? rows(pending.records).map((p) => text(p.expected_landing_at)).filter((v): v is string => Boolean(v)).sort()[0] ?? null : null,
    lastPull: verified && Object.keys(lastPull).length ? { amount: num(lastPull.amount), date: text(lastPull.date, lastPull.pulled_at, lastPull.created_at) } : null,
    brokerAgeMs: text(reader.schema_version) === "ap3x-reader-v1" ? sinceMs(reader.accounts_observed_at, ctx.now) : brokerSeconds === null ? null : brokerSeconds * 1000,
    quoteAgeMs: sinceMs(reader.quotes_observed_at, ctx.now),
    ledgerAgeMs: sinceMs(reader.ledger_observed_at, ctx.now),
    positions: positionsFrom(raw),
  };
}

export function capacityModel(payload: unknown, now: number): Capacity {
  const weekly = asDict(asDict(payload).weekly);
  const p = asDict(payload);
  if (!record(payload) || p.schema_version !== "AP3X-AI-CAPACITY-1" || p.state === "OFFLINE" || weekly.state !== "AVAILABLE" || weekly.limit_id !== "codex") {
    return { state: "OFFLINE", remaining: null, detail: "NO CONTRACT" };
  }
  const remaining = num(weekly.remaining_percent);
  const resets = Date.parse(text(weekly.resets_at) ?? "");
  const ageMs = sinceMs(p.generated_at, now);
  const observedMs = sinceMs(p.observed_at, now);
  let detail = "RESET UNKNOWN";
  if (Number.isFinite(resets)) {
    const minutes = Math.max(0, Math.ceil((resets - now) / 60_000));
    detail = minutes === 0 ? "REFRESHING" : `RESET ${Math.floor(minutes / 1440)}D ${Math.floor((minutes % 1440) / 60)}H`;
  }
  if (weekly.rate_limit_reached_type) return { state: "LIMIT", remaining: 0, detail };
  const state = ageMs === null || observedMs === null || ageMs > 15 * 60_000 || observedMs > 20 * 60_000 ? "STALE" : String(p.state).toUpperCase();
  return { state, remaining, detail };
}

export function marketsModel(ctx: ModuleContext): MarketsModel {
  const raw = ctx.sources.sentinel?.data;
  const markets = summarizeMarkets(raw, ctx.now);
  const candidateRows = rows(pick(raw, ["candidates", "ranked_candidates", "scan.candidates", "data.candidates"]));
  const scoreDirect = num(pick(raw, ["best_score", "top_score", "score", "candidate.score", "best_candidate.score", "focus.score"]));
  const scoreRows = candidateRows.map((row) => num(row.score, row.confidence, row.signal_score)).filter((v): v is number => v !== null);
  const score = markets.state === "live" && markets.session === "open" ? (scoreRows.length ? Math.max(scoreDirect ?? 0, ...scoreRows) : scoreDirect) : null;
  return {
    mode: ctx.mode, now: ctx.now,
    state: markets.state, session: markets.session, quoteMode: markets.quoteMode,
    quotes: Object.entries(markets.quotes).slice(0, 12).map(([symbol, q]) => ({ symbol, price: q.price, m5: q.move5mPct, m15: q.move15mPct })),
    score,
    sentinelState: markets.quoteMode === "retained" ? "CLOSED · RETAINED" : (text(pick(raw, ["state", "status", "health.state", "scan.state"])) ?? "UNKNOWN").toUpperCase(),
    candidates: candidateRows.map((row) => ({
      symbol: text(row.symbol, row.ticker, row.name) ?? "", score: num(row.score, row.confidence, row.signal_score),
      side: text(row.side, row.direction, row.bias)?.toUpperCase() ?? null, reason: text(row.reason, row.signal, row.thesis, row.summary, row.trigger),
    })).filter((row) => row.symbol).sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).slice(0, 12),
    quoteCount: markets.quoteCount ?? null, expectedQuotes: markets.expectedQuotes ?? null, generatedAt: markets.generatedAt,
    capacity: capacityModel(ctx.sources.capacity?.data, ctx.now),
  };
}

export type ControlTile = [label: string, state: string, detail: string];

export function controlModel(ctx: ModuleContext, cameraState: string): { tiles: ControlTile[]; mode: RunMode } {
  const data = (id: string) => ctx.sources[id]?.data;
  const services = parseServices([data("status"), data("ops-brief")], DEFAULT_SERVICES).services;
  const service = (name: string) => services.find((s) => s.name === name)?.state;
  const plex = data("plex-update");
  const plexInstalled = text(pick(plex, ["installed_version", "version"]));
  const plexLatest = text(pick(plex, ["latest_version", "available_version"]));
  const streams = num(pick(plex, ["active_streams", "session_count", "sessions.active", "streams"]), pick(data("ops-brief"), ["plex.active_streams", "media.plex_streams"]));
  const games = rows(pick(data("games"), ["games", "servers", "items", "data"]));
  const online = games.filter((g) => bool(g.online, g.active, g.running, g.state, g.status) === true);
  const music = data("music");
  return {
    mode: ctx.mode,
    tiles: [
      ["QUICKSILVER", (text(pick(data("quicksilver"), ["state", "status", "health.state"]), service("QuickSilver")) ?? "UNKNOWN").toUpperCase(), text(pick(data("quicksilver"), ["port", "endpoint"])) ?? "8765"],
      ["EPSILON", service("Epsilon") ?? "UNKNOWN", "PRIORITY BOT"],
      ["PLEX", plexInstalled && plexLatest && plexInstalled !== plexLatest ? "UPDATE READY" : service("Plex") ?? (plexInstalled ? "CURRENT" : "UNKNOWN"),
        streams === null ? plexInstalled ?? "—" : `${streams} STREAM${streams === 1 ? "" : "S"}`],
      ["GAMES", games.length ? `${online.length} ONLINE` : "UNKNOWN", text(online[0]?.name, online[0]?.game) ?? "—"],
      ["CLOUDFLARE", (text(pick(data("external"), ["cloudflare.state", "cloudflare.status", "services.cloudflare.state"])) ?? "UNKNOWN").toUpperCase(), "PUBLIC EDGE"],
      ["TAILSCALE", (text(pick(data("external"), ["tailscale.state", "tailscale.status", "services.tailscale.state"])) ?? "UNKNOWN").toUpperCase(), "TAILNET"],
      ["MUSIC", (text(pick(music, ["state", "status", "playback.state"])) ?? (record(music) ? "READY" : "UNKNOWN")).toUpperCase(),
        record(music) ? `${num(asDict(music).skip_counter) ?? 0} SKIPS` : "WALL CONTROL"],
      ["TRACKER", record(data("ops-brief")) ? "LIVE" : "UNKNOWN", "OPS BRIEF"],
      ["CAMERA", cameraState, "GO2RTC"],
    ],
  };
}

export const controlTone = (state: string) => toneFor(state);

/* ---------------- demo payloads: made-up figures in the feed formats ---------------- */

const SYMBOLS: Record<string, number> = { VOO: 552.4, QQQ: 489.1, NVDA: 142.6, AMD: 156.3, MSFT: 431.8, AAPL: 228.5, SPY: 601.2, TSLA: 251.9 };

export function demoMarkets(now: number): Record<string, unknown> {
  const stamp = new Date(now - 30_000).toISOString();
  const wave = (i: number) => Math.round(Math.sin(i * 1.7) * 60) / 100;
  const holdings: Record<AccountKey, [string, number, number, number][]> = {
    taxable: [["VOO", 40, 552.4, 498.2], ["MSFT", 18, 431.8, 389.0], ["AAPL", 20, 228.5, 201.3]],
    roth_ira: [["VOO", 28, 552.4, 470.1], ["QQQ", 22, 489.1, 431.7]],
    agentic: [["NVDA", 35, 142.6, 118.4], ["AMD", 18, 156.3, 171.9]],
    smart_income: [["SPY", 8, 601.2, 588.0]],
  };
  const accounts = Object.fromEntries(Object.entries(holdings).map(([key, list]) => {
    const positions = list.map(([symbol, qty, price, avg]) => ({ symbol, qty, current_price: price, avg_entry_price: avg, lastday_price: Math.round((price / 1.004) * 100) / 100 }));
    const value = positions.reduce((s, p) => s + p.qty * p.current_price, 0);
    return [key, { account_value: value.toFixed(2), positions }];
  }));
  const total = Object.values(accounts).reduce((s, a) => s + Number((a as { account_value: string }).account_value), 0);
  return {
    finance: {
      accounts, all_accounts_total: Math.round(total * 100) / 100,
      coverage: { complete: true, available_account_count: 4, missing_accounts: [], unexpected_accounts: [], duplicate_accounts: [] },
      broker_snapshot: { fresh: true, age_seconds: 240 },
      reader: { status: "RUNNING", accounts_observed_at: stamp, quotes_observed_at: stamp, ledger_observed_at: new Date(now - 3_600_000).toISOString() },
      day_change: 412.35, day_change_pct: 0.49,
      roth_contributions: { available: true, history_complete: true, last_pull: { amount: 100, date: new Date(now - 4 * 86_400_000).toISOString().slice(0, 10) },
        pending: { count: 1, total: 165, records: [{ expected_landing_at: new Date(now + 5 * 86_400_000).toISOString() }] } },
    },
    sentinel: {
      generated_at: stamp, session: "regular", state: "LIVE",
      health: { active_trading_session: true, scan_complete: true, state_stale: false, symbols_expected: 8, fresh_quote_count: 8, fetch_failure_count: 0 },
      prices: Object.fromEntries(Object.entries(SYMBOLS).map(([symbol, price], i) => [symbol, { price, available: true, fresh_for_trading: true, move_5m_pct: wave(i), move_15m_pct: wave(i + 3) }])),
      candidates: [
        { symbol: "NVDA", score: 82, side: "long", reason: "Volume expansion above 15m VWAP" },
        { symbol: "AMD", score: 77, side: "long", reason: "Relative strength vs SOX" },
        { symbol: "TSLA", score: 64, side: "short", reason: "Failed breakout, fading momentum" },
      ],
    },
    capacity: {
      schema_version: "AP3X-AI-CAPACITY-1", state: "LIVE", generated_at: stamp, observed_at: stamp,
      weekly: { state: "AVAILABLE", limit_id: "codex", remaining_percent: 63.5, resets_at: new Date(now + (3 * 24 + 7) * 3_600_000).toISOString() },
    },
  };
}

export function demoControl(): Record<string, unknown> {
  return {
    quicksilver: { state: "RUNNING", port: "8765" },
    "plex-update": { installed_version: "1.41.2", latest_version: "1.41.2", active_streams: 1 },
    games: { games: [{ name: "Minecraft", online: true }, { name: "Valheim", online: false }] },
    external: { cloudflare: { state: "HEALTHY" }, tailscale: { state: "CONNECTED" } },
    music: { state: "READY", skip_counter: 0 },
    status: { services: [{ name: "epsilon", state: "ONLINE", online: true }, { name: "plex", state: "CURRENT", online: true }, { name: "quicksilver", state: "RUNNING", online: true }] },
    "ops-brief": { posture: "NOMINAL" },
  };
}
