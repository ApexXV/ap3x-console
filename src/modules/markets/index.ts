import { bar, el, setTone, svgEl } from "../../core/dom";
import { dlist, linkButton, note, place, sec, stats, table, type Cell } from "../../core/detail";
import { ageLabel, clockOf, money, signedMoney, signedPct, sinceMs, toneFor, TZ } from "../../core/format";
import type { Chip, ModuleManifest, Tone } from "../../core/types";
import { cameraState } from "../camera";
import {
  ACCOUNT_ROWS, CAPACITY_SOURCE, CONTROL_SOURCES, type ControlTile, controlModel, demoControl, demoMarkets, FINANCE_SOURCE,
  type FinanceModel, financeModel, type MarketsModel, marketsModel, type Position, SENTINEL_SOURCE,
} from "./model";
import "../business/business.css";
import "./markets.css";

/* Command 57's finance & markets column: portfolio, watchlist, Market Sentinel with Codex
 * capacity, and control & external status. Status only; nothing here can trade or send commands. */

const priv = <T extends HTMLElement>(node: T): T => { node.dataset.private = ""; return node; };

function compactMoney(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${value < 0 ? "−" : ""}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e4) return `${value < 0 ? "−" : ""}$${(abs / 1e3).toFixed(1)}K`;
  return `${value < 0 ? "−" : ""}$${abs.toFixed(0)}`;
}

const landingDay = (stamp: string | null) => {
  const parsed = Date.parse(stamp ?? "");
  return Number.isFinite(parsed) ? new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric" }).format(parsed).toUpperCase() : "—";
};

/* ---------------- equity history: kept in this browser for 24 h, like the wall ---------------- */

const EQUITY_KEY = "console-equity-history";
let equity: [number, number][] | null = null;

function equityHistory(f: FinanceModel): [number, number][] {
  if (equity === null) {
    equity = [];
    try {
      const saved = JSON.parse(localStorage.getItem(EQUITY_KEY) ?? "[]");
      if (Array.isArray(saved)) equity = saved.filter((p): p is [number, number] => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    } catch { /* optional */ }
  }
  equity = equity.filter(([t]) => f.now - t <= 24 * 3_600_000);
  if (f.mode === "demo") {
    if (!equity.length && f.equity !== null) {
      for (let i = 72; i > 0; i -= 1) equity.push([f.now - i * 5 * 60_000, f.equity * (1 - i * 0.00004 + Math.sin(i / 7) * 0.0015)]);
    }
    return equity;
  }
  const last = equity[equity.length - 1];
  if (f.equity !== null && f.state !== "unknown" && (!last || f.now - last[0] >= 60_000)) {
    equity.push([f.now, f.equity]);
    equity = equity.slice(-1440);
    try { localStorage.setItem(EQUITY_KEY, JSON.stringify(equity.map(([t, v]) => [t, Math.round(v * 100) / 100]))); } catch { /* optional */ }
  }
  return equity;
}

function lineChart(points: [number, number][], format: (v: number) => string, emptyText: string): HTMLElement {
  const wrap = el("div", "dchart");
  if (points.length < 2) { wrap.append(el("div", "empty", emptyText)); return wrap; }
  const W = 1000, H = 400;
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs) || x0 + 1;
  const pad = (Math.max(...ys) - Math.min(...ys)) * 0.12 || Math.abs(ys[0]!) * 0.002 || 1;
  const y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
  const px = (t: number) => ((t - x0) / (x1 - x0 || 1)) * (W - 120);
  const py = (v: number) => H - ((v - y0) / (y1 - y0)) * H;
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none" });
  for (let i = 1; i < 4; i += 1) svg.append(svgEl("line", { class: "grid", x1: 0, x2: W - 120, y1: (H / 4) * i, y2: (H / 4) * i }));
  const line = points.map(([t, v]) => `${px(t)},${py(v)}`).join(" ");
  svg.append(svgEl("polygon", { class: "area", points: `0,${H} ${line} ${px(x1)},${H}` }), svgEl("polyline", { class: "line", points: line }));
  const axis = el("div", "axis");
  for (const t of [x0, x0 + (x1 - x0) / 2, x1]) axis.append(el("span", "", clockOf(new Date(t).toISOString())));
  const yaxis = el("div", "yaxis");
  for (const v of [y1, (y0 + y1) / 2, y0]) yaxis.append(el("span", "", format(v)));
  wrap.append(svg, axis, yaxis);
  return priv(wrap);
}

function positionTable(positions: Position[], base: number): HTMLElement {
  const colorOf = Object.fromEntries(ACCOUNT_ROWS.map(([key, , color]) => [key, color]));
  const labelOf = Object.fromEntries(ACCOUNT_ROWS.map(([key, label]) => [key, label]));
  const hasDay = positions.some((p) => p.dayPct !== null);
  const hasPl = positions.some((p) => p.plPct !== null);
  const qtyText = (q: number | null) => (q === null ? "—" : q.toLocaleString("en-US", { maximumFractionDigits: 3 }));
  const headers = ["SYMBOL", "HELD IN", "SHARES", "PRICE", "VALUE", "OF PORTFOLIO"];
  if (hasDay) headers.push("DAY");
  if (hasPl) headers.push("P/L");
  const body = positions.slice(0, 9).map((p) => {
    const held = el("span", "held");
    if (!p.accounts.length) held.append(el("em", "", "ALL ACCOUNTS"));
    for (const a of p.accounts) {
      const chip = el("span", "held-chip");
      const dot = el("i", "dot");
      dot.style.background = colorOf[a.account] ?? "var(--dim)";
      chip.append(dot, `${labelOf[a.account] ?? a.account.toUpperCase()} ${qtyText(a.qty)}`);
      held.append(chip);
    }
    const row: Cell[] = [[p.symbol, "info"], held, qtyText(p.qty), p.price === null ? "—" : money(p.price), p.value === null ? "—" : money(p.value, 0),
      base && p.value !== null ? `${((p.value / base) * 100).toFixed(1)}%` : "—"];
    if (hasDay) row.push([signedPct(p.dayPct), p.dayPct === null ? "muted" : p.dayPct < 0 ? "bad" : "good"]);
    if (hasPl) row.push([p.pl !== null ? `${signedMoney(p.pl, 0)} · ${signedPct(p.plPct)}` : signedPct(p.plPct), p.plPct === null ? "muted" : p.plPct < 0 ? "bad" : "good"]);
    return row;
  });
  return table(headers, body, headers.map((_, i) => i).filter((i) => i >= 2), [2, 4, 7]);
}

const financeChip = (f: FinanceModel): Chip => (f.equity !== null ? { label: `4/4 · ${f.state.toUpperCase()}`, tone: f.state === "live" ? "good" : "warn" }
  : f.state === "unknown" ? { label: "UNAVAILABLE", tone: "muted" } : { label: `${f.coverage ?? 0}/4 PARTIAL`, tone: "muted" });

export const portfolioModule: ModuleManifest<FinanceModel> = {
  id: "portfolio",
  title: "PORTFOLIO · 4 ACCOUNTS",
  description: "Combined equity across the four brokerage accounts (withheld unless all four reconcile), the last session's change, Roth contributions, and holdings.",
  version: "1.0.0",
  sources: [FINANCE_SOURCE],
  model: financeModel,

  render(body, f) {
    equityHistory(f);
    const complete = f.equity !== null;
    const dayKnown = complete && (f.dayDollar !== null || f.dayPct !== null);
    const day = el("div", "kpi-sub pf-day", dayKnown ? `${[f.dayDollar !== null ? signedMoney(f.dayDollar) : null, f.dayPct !== null ? signedPct(f.dayPct) : null].filter(Boolean).join(" · ")} last session` : "Last session change unavailable");
    if (dayKnown) setTone(day, (f.dayDollar ?? f.dayPct ?? 0) < 0 ? "bad" : "good");
    if (dayKnown) day.style.color = "var(--tone)";
    const accounts = ACCOUNT_ROWS.map(([key, label, color]) => ({ label, color, value: f.accounts[key] }));
    const total = accounts.reduce((s, a) => s + (a.value ?? 0), 0) || 1;
    const stack = el("div", "pf-stack");
    stack.append(...accounts.map((a) => { const seg = el("span"); seg.style.background = a.color; seg.style.width = `${((a.value ?? 0) / total) * 100}%`; return seg; }));
    const legend = el("ul", "legend legend-inline");
    legend.append(...accounts.map((a) => {
      const li = el("li");
      const dot = el("i", "dot");
      dot.style.background = a.color;
      li.append(dot, priv(el("span", "", `${a.label} ${a.value === null ? "—" : compactMoney(a.value)}`)));
      return li;
    }));
    const facts = el("dl", "facts facts-3 pf-facts");
    for (const [label, value] of [
      ["WEEKLY ROTH", f.weekly === null ? "WITHHELD" : money(f.weekly, 0)],
      ["SETTLING", f.pendingCount === null ? "WITHHELD" : f.pendingCount
        ? `${money(f.pendingTotal, 0)}${f.pendingLanding ? ` · ${landingDay(f.pendingLanding)}` : f.pendingCount > 1 ? ` · ${f.pendingCount}` : ""}` : "NONE"],
      ["BROKER AGE", ageLabel(f.brokerAgeMs)],
    ] as const) {
      const div = el("div");
      div.append(el("dt", "", label), label === "BROKER AGE" ? el("dd", "", value) : priv(el("dd", "", value)));
      facts.append(div);
    }
    body.replaceChildren(priv(el("div", "kpi-value", complete ? money(f.equity, 0) : "WITHHELD")), day, stack, legend, facts);
  },

  chip: financeChip,

  detail(f) {
    const complete = f.equity !== null;
    const accounts = ACCOUNT_ROWS.map(([key, label, color]) => ({ key, label, color, value: f.accounts[key] }));
    const total = accounts.reduce((s, a) => s + (a.value ?? 0), 0) || 1;
    const history = equityHistory(f);
    const trend = history[0] && complete ? f.equity! - history[0][1] : null;
    const posTotal = f.positions.reduce((s, p) => s + (p.value ?? 0), 0) || 1;
    return {
      title: "PORTFOLIO · 4 ACCOUNTS",
      chip: financeChip(f),
      foot: `Read-only broker snapshot · reader ${f.readerState ?? "unknown"} · total withheld unless all four accounts reconcile`,
      columns: "minmax(0, 1.6fr) minmax(0, 1fr)", rows: "auto minmax(0, 1fr) minmax(0, 1.05fr)",
      sections: [
        place(priv(stats([
          ["COMBINED EQUITY", complete ? money(f.equity, 0) : "WITHHELD", complete ? "info" : "warn"],
          ["LAST SESSION", f.dayDollar !== null ? signedMoney(f.dayDollar, 0) : null, (f.dayDollar ?? 0) < 0 ? "bad" : "good", f.dayPct !== null ? signedPct(f.dayPct) : null],
          ["CONSOLE TREND", trend !== null ? signedMoney(trend, 0) : null, (trend ?? 0) < 0 ? "bad" : "good",
            history.length > 1 ? `since ${clockOf(new Date(history[0]![0]).toISOString())} ET` : "builds while the console runs"],
          ["WEEKLY ROTH", f.weekly === null ? "WITHHELD" : money(f.weekly, 0), null, f.lastPull?.date ? `last pull ${f.lastPull.date}` : null],
          ["SETTLING", f.pendingCount === null ? "WITHHELD" : f.pendingCount ? money(f.pendingTotal, 0) : "NONE", f.pendingCount ? "info" : "good",
            f.pendingCount ? `${f.pendingLanding ? `lands ${landingDay(f.pendingLanding)}` : "landing date unknown"}${f.pendingCount > 1 ? ` · ${f.pendingCount} transfers` : ""}` : null],
          ["HOLDINGS", f.positions.length || null, null, f.positions.length ? `largest: ${f.positions[0]!.symbol}` : "not in feed"],
        ])), "1 / -1"),
        sec("EQUITY TREND · LAST 24H IN THIS BROWSER", lineChart(history, (v) => money(v, Math.abs(v) < 10_000 ? 2 : 0), "Trend appears after a few refreshes. History is kept in this browser for 24 hours.")),
        sec("ACCOUNTS", table(["ACCOUNT", "VALUE", "SHARE", ""], accounts.map((a) => {
          const label = el("span");
          const dot = el("i", "dot");
          dot.style.background = a.color;
          label.append(dot, ` ${a.label}`);
          return [label, a.value === null ? "—" : money(a.value, 0), a.value === null ? "—" : `${((a.value / total) * 100).toFixed(1)}%`, bar((a.value ?? 0) / total, "info")];
        }), [1, 2], [1])),
        sec("TOP HOLDINGS · COMBINED ACROSS ACCOUNTS", f.positions.length ? positionTable(f.positions, complete ? f.equity! : posTotal)
          : note("Position detail is not included in the finance feed yet. Account totals above are complete.")),
        sec("DATA FRESHNESS", dlist([
          { title: "Broker accounts", detail: "Account values from the broker reader", tag: ageLabel(f.brokerAgeMs), tone: f.brokerAgeMs !== null && f.brokerAgeMs < 30 * 60_000 ? "good" : "warn" },
          { title: "Quotes", detail: "Last quote fetch", tag: ageLabel(f.quoteAgeMs), tone: f.quoteAgeMs !== null && f.quoteAgeMs < 10 * 60_000 ? "good" : "muted" },
          { title: "Contribution ledger", detail: "Roth contribution history", tag: ageLabel(f.ledgerAgeMs), tone: f.ledgerAgeMs !== null ? "good" : "muted" },
        ]), linkButton("OPEN FINANCE WALL", "/finance-canary.html")),
      ],
    };
  },

  demo: demoMarkets,
};

/* ---------------- watchlist ---------------- */

const quoteHistory = new Map<string, number[]>();
const quotesChip = (mk: MarketsModel): Chip => (mk.state === "unknown" ? { label: "UNAVAILABLE", tone: "muted" }
  : { label: `${mk.quoteMode === "retained" ? "RETAINED" : mk.session.toUpperCase()} · ${mk.state.toUpperCase()}`, tone: mk.state === "live" ? "good" : "warn" });

function historyOf(mk: MarketsModel, q: MarketsModel["quotes"][number]): number[] {
  const history = quoteHistory.get(q.symbol) ?? (mk.mode === "demo"
    ? Array.from({ length: 36 }, (_, i) => q.price * (1 + Math.sin(i / 4 + q.price) * 0.006 + (i - 36) * 0.0002 * Math.sign(q.m15 ?? 1))) : []);
  if (history[history.length - 1] !== q.price) history.push(q.price);
  while (history.length > 48) history.shift();
  quoteHistory.set(q.symbol, history);
  return history;
}

function spark(history: number[], height: number): SVGSVGElement {
  const svg = svgEl("svg", { viewBox: `0 0 100 ${height}`, preserveAspectRatio: "none" });
  if (history.length > 1) {
    const lo = Math.min(...history), hi = Math.max(...history), span = hi - lo || 1;
    svg.append(svgEl("polyline", { points: history.map((v, i) => `${(i / (history.length - 1)) * 100},${height - 2 - ((v - lo) / span) * (height - 4)}`).join(" ") }));
  }
  return svg;
}

const moveTone = (move: number | null): Tone => (move === null ? "muted" : move < 0 ? "bad" : "good");

export const watchlistModule: ModuleManifest<MarketsModel> = {
  id: "watchlist",
  title: "WATCHLIST",
  description: "Market Sentinel quotes with 5- and 15-minute moves and a sparkline of prices seen while the console runs; retained when the market is closed.",
  version: "1.0.0",
  sources: [SENTINEL_SOURCE, CAPACITY_SOURCE],
  model: marketsModel,

  render(body, mk) {
    const grid = el("div", "quotes");
    grid.append(...(mk.quotes.length ? mk.quotes.map((q) => {
      const move = q.m15 ?? q.m5;
      const node = el("div", "quote");
      setTone(node, moveTone(move));
      node.append(el("b", "", q.symbol), el("strong", "", money(q.price)), el("span", "", "15M"), el("em", "", signedPct(move)), spark(historyOf(mk, q), 30));
      return node;
    }) : [el("div", "subnote", "No current quotes.")]));
    body.replaceChildren(grid);
  },

  ticker: (mk) => mk.quotes.slice(0, 8).map((q) => ({ label: q.symbol, value: `${money(q.price)} ${signedPct(q.m15 ?? q.m5 ?? null)}`, order: 30 })),

  chip: quotesChip,

  detail(mk) {
    const cards = el("div", "dcards");
    cards.append(...mk.quotes.map((q) => {
      const history = quoteHistory.get(q.symbol) ?? [];
      const move = q.m15 ?? q.m5;
      const card = el("article", "dcard");
      setTone(card, moveTone(move));
      const head = el("header");
      head.append(el("b", "", q.symbol), el("strong", "", money(q.price)));
      const moves = el("div", "moves");
      for (const [label, v] of [["5M", q.m5], ["15M", q.m15]] as const) { const span = el("span", "", `${label} `); span.append(el("em", "", signedPct(v))); moves.append(span); }
      const lo = history.length ? Math.min(...history) : null, hi = history.length ? Math.max(...history) : null;
      card.append(head, moves, spark(history, 40), el("footer", "", lo === null ? "RANGE —" : `CONSOLE RANGE ${money(lo)} – ${money(hi)}`));
      return card;
    }));
    return {
      title: "WATCHLIST",
      chip: quotesChip(mk),
      foot: `Market Sentinel quotes${mk.quoteCount !== null ? ` · ${mk.quoteCount}/${mk.expectedQuotes ?? "?"} fresh` : ""}${mk.generatedAt ? ` · scanned ${ageLabel(sinceMs(mk.generatedAt, mk.now))}` : ""} · informational, read-only`,
      columns: "minmax(0, 1fr)", rows: "minmax(0, 1fr)",
      sections: [mk.quotes.length ? cards : sec(null, note("No current quotes."))],
    };
  },

  demo: demoMarkets,
};

/* ---------------- sentinel + capacity ---------------- */

const scoreLabel = (s: number | null) => (s === null ? "NO CURRENT SCORE" : s >= 95 ? "HIGH" : s >= 90 ? "ACTIONABLE" : s >= 80 ? "WATCH" : "CALM");
const scoreTone = (s: number | null): Tone => (s === null ? "muted" : s >= 95 ? "bad" : s >= 80 ? "warn" : "good");
const sentinelChip = (mk: MarketsModel): Chip => ({ label: `SENTINEL ${mk.sentinelState}`, tone: mk.quoteMode === "retained" ? "info" : toneFor(mk.sentinelState) });

export const sentinelModule: ModuleManifest<MarketsModel> = {
  id: "sentinel",
  title: "SENTINEL · AI CAPACITY",
  description: "The Market Sentinel's top open-session score and ranked candidates, and how much of the weekly Codex capacity is left.",
  version: "1.0.0",
  sources: [SENTINEL_SOURCE, CAPACITY_SOURCE],
  model: marketsModel,

  render(body, mk) {
    const gauge = el("div", "gauge");
    setTone(gauge, scoreTone(mk.score));
    const svg = svgEl("svg", { viewBox: "0 0 200 120", "aria-hidden": "true" });
    svg.append(svgEl("path", { class: "gauge-bg", d: "M20 110 A80 80 0 0 1 180 110", pathLength: 100 }));
    const arc = svgEl("path", { class: "gauge-arc", d: "M20 110 A80 80 0 0 1 180 110", pathLength: 100 });
    arc.style.setProperty("--off", String(100 - (mk.score ?? 0)));
    svg.append(arc);
    gauge.append(svg, el("b", "", mk.score === null ? "—" : String(Math.round(mk.score))), el("span", "", scoreLabel(mk.score)));
    const cap = mk.capacity;
    const capacity = el("div", "capacity");
    const meter = el("div", "meter");
    const fill = el("span");
    fill.style.width = `${cap.remaining ?? 0}%`;
    meter.append(fill);
    capacity.append(el("span", "kicker", "CODEX WEEKLY"), el("b", "", cap.remaining === null ? "—" : `${cap.remaining.toFixed(1)}% LEFT`), meter, el("span", "subnote", `${cap.state} · ${cap.detail}`));
    const split = el("div", "split");
    split.append(gauge, capacity);
    body.replaceChildren(split);
  },

  chip: sentinelChip,

  detail(mk) {
    const cap = mk.capacity;
    return {
      title: "MARKET SENTINEL · AI CAPACITY",
      chip: sentinelChip(mk),
      foot: "Scores are informational · trading authority remains read-only / paper constrained",
      columns: "minmax(0, 1.6fr) minmax(0, 1fr)", rows: "auto minmax(0, 1fr)",
      sections: [
        place(stats([
          ["TOP SCORE", mk.score === null ? null : Math.round(mk.score), scoreTone(mk.score), mk.score === null ? "no open-session score" : scoreLabel(mk.score)],
          ["SESSION", mk.session.toUpperCase()],
          ["QUOTE MODE", mk.quoteMode.toUpperCase()],
          ["CODEX WEEKLY", cap.remaining === null ? null : `${cap.remaining.toFixed(1)}%`, cap.remaining === null ? "muted" : cap.remaining < 15 ? "bad" : cap.remaining < 35 ? "warn" : "good", "remaining"],
          ["CAPACITY RESET", cap.detail.replace("RESET ", ""), null, cap.state],
        ]), "1 / -1"),
        sec("RANKED CANDIDATES", mk.candidates.length ? table(["SYMBOL", "SCORE", "", "BIAS", "SIGNAL"], mk.candidates.map((c) => [
          [c.symbol, "info"], c.score === null ? "—" : Math.round(c.score), bar((c.score ?? 0) / 100, scoreTone(c.score ?? 0)), c.side ?? "—", c.reason ?? "—",
        ]), [1]) : note("No ranked candidates in the current Sentinel scan.")),
        sec("SCORE BANDS", dlist([
          { title: "95+ · HIGH", detail: "Strongest signal; still informational only.", tag: "HIGH", tone: "bad" },
          { title: "90–94 · ACTIONABLE", detail: "Meets the actionable threshold.", tag: "ACT", tone: "warn" },
          { title: "80–89 · WATCH", detail: "Worth watching; no trigger.", tag: "WATCH", tone: "warn" },
          { title: "Below 80 · CALM", detail: "Baseline conditions.", tag: "CALM", tone: "good" },
        ]), linkButton("OPEN MARKETS WALL", "/markets-canary.html")),
      ],
    };
  },

  demo: demoMarkets,
};

/* ---------------- control & external ---------------- */

interface ControlModel { tiles: ControlTile[] }
const controlTone = (state: string): Tone => toneFor(state);

function controlGrid(tiles: ControlTile[], large = false): HTMLElement {
  const grid = el("div", large ? "control-grid is-large" : "control-grid");
  grid.append(...tiles.map(([label, state, detail]) => {
    const tile = el("div", "control");
    setTone(tile, controlTone(state));
    tile.append(el("span", "", `${label} · ${detail}`), el("b", "", state));
    return tile;
  }));
  return grid;
}

export const controlModule: ModuleManifest<ControlModel, { cameraUrl: string }> = {
  id: "control",
  title: "CONTROL & EXTERNAL",
  description: "Status tiles for QuickSilver, Epsilon, Plex, game servers, Cloudflare, Tailscale, wall music, the tracker, and the camera. Status only; never sends commands.",
  version: "1.0.0",
  defaults: { cameraUrl: "/go2rtc/api/frame.jpeg?src=office_cam_wall" },
  sources: CONTROL_SOURCES,
  model: (ctx) => controlModel(ctx, ctx.mode === "demo" ? "ONLINE" : cameraState(ctx.settings.cameraUrl, ctx.now)),

  render(body, m) {
    body.replaceChildren(controlGrid(m.tiles));
  },

  chip(m) {
    const bad = m.tiles.filter(([, s]) => controlTone(s) === "bad").length;
    return bad ? { label: `${bad} DOWN`, tone: "bad" } : { label: "NOMINAL", tone: "good" };
  },

  detail(m) {
    return {
      title: "CONTROL & EXTERNAL",
      chip: { label: `${m.tiles.filter(([, s]) => controlTone(s) === "good").length}/${m.tiles.length} NOMINAL`, tone: m.tiles.some(([, s]) => controlTone(s) === "bad") ? "bad" : "good" },
      foot: "Status only · this console never sends commands",
      columns: "minmax(0, 1fr)", rows: "minmax(0, 1fr)",
      sections: [sec(null, controlGrid(m.tiles, true))],
    };
  },

  demo: demoControl,

  changes(previous, next) {
    return next.tiles.flatMap(([label, state]) => {
      const before = previous.tiles.find(([l]) => l === label)?.[1];
      if (!before || before === state) return [];
      if (controlTone(state) === "bad") return [{ tone: "bad" as Tone, kicker: "CONTROL", text: `${label} is ${state}` }];
      if (controlTone(before) === "bad") return [{ tone: "good" as Tone, kicker: "CONTROL", text: `${label} is back (${state})` }];
      return [];
    });
  },
};

export const marketsModules = [portfolioModule, watchlistModule, sentinelModule, controlModule];
