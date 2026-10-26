import { bar, el, setTone } from "../../core/dom";
import { dlist, linkButton, note, place, sec, stats, table } from "../../core/detail";
import { ageLabel, clockOf, dueLabel, dueTone, money, signedMoney, sinceMs } from "../../core/format";
import { tonightLabel } from "../../core/ticker";
import type { Chip, ModuleManifest, Tone } from "../../core/types";
import { cashflowChart, donut, obligationTimeline, weekBars } from "./charts";
import { BUSINESS_SOURCES, type BusinessModel, businessModel, demoBusiness, REVIEW_ROWS, visible, weeksFromDaily } from "./model";
import "./business.css";

/* Command 57's business column: bank cash flow, receipts, the ledger review queue, the daily cash
 * flow chart, books health, obligations, and the latest receipt. All amounts are marked private. */

type Manifest = ModuleManifest<BusinessModel>;
const base = { version: "1.0.0", sources: BUSINESS_SOURCES, model: businessModel, demo: demoBusiness } as const;
const pad2 = (v: number | null) => (v === null ? "—" : String(v).padStart(2, "0"));
const stateChip = (state: string, unavailable = "UNAVAILABLE"): Chip =>
  visible(state) ? { label: state.toUpperCase(), tone: state === "live" ? "good" : "warn" } : { label: unavailable, tone: "muted" };

function priv<T extends HTMLElement>(node: T): T {
  node.dataset.private = "";
  return node;
}

function facts(items: [label: string, value: string, dot?: Tone][]): HTMLElement {
  const dl = el("dl", "facts facts-3");
  dl.append(...items.map(([label, value, dot]) => {
    const div = el("div");
    const dt = el("dt");
    if (dot) { const d = el("i", "dot"); setTone(d, dot); dt.append(d); }
    dt.append(label);
    div.append(dt, priv(el("dd", "", value)));
    return div;
  }));
  return dl;
}

/* ---------------- bank: posted net, last 30 days ---------------- */

export const bankModule: Manifest = {
  ...base,
  id: "business-bank",
  title: "POSTED NET · LAST 30 DAYS",
  description: "Business bank movement over the last 30 days: posted net, money in and out, transactions, and the weekly trend.",

  render(body, m) {
    const b = m.bank;
    const ok = visible(b.state);
    const value = priv(el("div", "kpi-value", ok ? signedMoney(b.postedNet) : "—"));
    setTone(value, ok ? (b.postedNet! < 0 ? "bad" : "good") : "muted");
    body.replaceChildren(
      value,
      facts([["MONEY IN", ok ? money(b.postedIn, 0) : "—", "good"], ["MONEY OUT", ok ? money(b.postedOut, 0) : "—", "bad"], ["TRANSACTIONS", ok ? String(b.transactionCount) : "—"]]),
      weekBars(ok ? weeksFromDaily(m.daily).slice(-4) : []),
      el("div", "kpi-foot", ok ? `Bank movement · not profit${b.asOf ? ` · as of ${clockOf(b.asOf)} ET` : ""}` : "Banking unavailable · not profit"),
    );
  },

  ticker: (m) => (visible(m.bank.state)
    ? [{ label: "BANK 30D", value: `${signedMoney(m.bank.postedNet, 0)} net · ${money(m.bank.postedIn, 0)} in · ${money(m.bank.postedOut, 0)} out`, private: true, order: 10 }]
    : []),

  chip: (m) => (visible(m.bank.state) ? stateChip(m.bank.state) : { label: m.bank.connected === false ? "DISCONNECTED" : "UNAVAILABLE", tone: "muted" }),

  detail(m) {
    const b = m.bank;
    const ok = visible(b.state);
    const daily = ok ? m.daily : [];
    const days = daily.length || 1;
    const best = daily.reduce<typeof daily[number] | null>((a, d) => (!a || d.net > a.net ? d : a), null);
    const worst = daily.reduce<typeof daily[number] | null>((a, d) => (!a || d.net < a.net ? d : a), null);
    const sum = (list: typeof daily) => list.reduce((s, d) => s + d.net, 0);
    const last7 = sum(daily.slice(-7)), prior7 = sum(daily.slice(-14, -7));
    const recent = daily.slice(-14).reverse();
    return {
      title: "CASH FLOW · LAST 30 DAYS",
      chip: this.chip!(m),
      foot: ok ? `Bank movement from the connected business account · not profit${b.asOf ? ` · as of ${clockOf(b.asOf)} ET` : ""}` : "Banking source unavailable",
      columns: "minmax(0, 2.2fr) minmax(0, 1fr)", rows: "auto minmax(0, 1fr)",
      sections: [
        place(priv(stats([
          ["POSTED NET", ok ? signedMoney(b.postedNet, 0) : null, ok ? (b.postedNet! < 0 ? "bad" : "good") : "muted", "30 days"],
          ["MONEY IN", ok ? money(b.postedIn, 0) : null, "good"],
          ["MONEY OUT", ok ? money(b.postedOut, 0) : null, "bad"],
          ["TRANSACTIONS", ok ? b.transactionCount : null],
          ["AVG DAILY IN", ok ? money(b.postedIn! / days, 0) : null, "good"],
          ["AVG DAILY OUT", ok ? money(b.postedOut! / days, 0) : null, "bad"],
          ["BEST DAY", best ? signedMoney(best.net, 0) : null, "good", best?.date],
          ["LAST 7D VS PRIOR", daily.length >= 14 ? signedMoney(last7 - prior7, 0) : null, last7 >= prior7 ? "good" : "warn",
            daily.length >= 14 ? `${signedMoney(last7, 0)} vs ${signedMoney(prior7, 0)}` : "needs 14 days"],
        ], 8)), "1 / -1"),
        sec("DAILY IN / OUT · RUNNING NET", cashflowChart(daily)),
        sec("RECENT DAYS", recent.length ? table(["DATE", "IN", "OUT", "NET", "TXNS"], recent.map((d) => [
          d.date, [money(d.moneyIn, 0), d.moneyIn ? "good" : "muted"], [money(d.moneyOut, 0), d.moneyOut ? "bad" : "muted"],
          [signedMoney(d.net, 0), d.net < 0 ? "bad" : d.net > 0 ? "good" : "muted"], d.count,
        ]), [1, 2, 3, 4], [1, 2, 3]) : note("No daily bank activity available."),
        worst ? priv(note(`Largest net outflow day: ${worst.date} · ${signedMoney(worst.net, 0)}`)) : null),
      ],
    };
  },
};

/* ---------------- receipts: gross received this year ---------------- */

export const receiptsModule: Manifest = {
  ...base,
  id: "business-receipts",
  title: "GROSS RECEIVED · 2026",
  description: "Year-to-date gross receipts from the Cash Inflow ledger, split by deposit status (tracked separately from bank movement).",

  render(body, m) {
    const rc = m.receipts;
    const ok = visible(rc.state);
    const gross = ok && rc.grossReceived! > 0 ? rc.grossReceived! : 0;
    const stack = el("div", "stack");
    for (const [value, cls] of [[rc.deposited, "seg-good"], [rc.undeposited, "seg-warn"], [rc.depositUnknown, "seg-muted"]] as const) {
      const seg = el("span", cls);
      seg.style.width = `${gross ? ((value ?? 0) / gross) * 100 : 0}%`;
      stack.append(seg);
    }
    body.replaceChildren(
      priv(el("div", "kpi-value", ok ? money(rc.grossReceived, 0) : "—")),
      el("div", "kpi-sub", ok ? `across ${rc.receiptCount} receipt${rc.receiptCount === 1 ? "" : "s"}${rc.asOf ? ` · latest ${rc.asOf}` : ""}` : "Cash inflow ledger unavailable"),
      stack,
      facts([["DEPOSITED", ok ? money(rc.deposited, 0) : "—", "good"], ["UNDEPOSITED", ok ? money(rc.undeposited, 0) : "—", "warn"], ["UNKNOWN", ok ? money(rc.depositUnknown, 0) : "—", "muted"]]),
    );
  },

  ticker: (m) => (visible(m.receipts.state)
    ? [{ label: "RECEIVED 2026", value: `${money(m.receipts.grossReceived, 0)} across ${m.receipts.receiptCount} receipts`, private: true, order: 11 }]
    : []),

  chip: (m) => stateChip(m.receipts.state),

  detail(m) {
    const rc = m.receipts;
    const ok = visible(rc.state);
    const extra = m.receiptsExtra;
    const gross = ok && rc.grossReceived! > 0 ? rc.grossReceived! : 0;
    const parts: [string, number | null, Tone, string][] = [
      ["DEPOSITED", rc.deposited, "good", "Recorded as deposited to the business account."],
      ["UNDEPOSITED", rc.undeposited, "warn", "Received but not yet deposited."],
      ["DEPOSIT UNKNOWN", rc.depositUnknown, "muted", "Deposit status not recorded on the receipt."],
    ];
    return {
      title: "GROSS RECEIVED · 2026",
      chip: stateChip(rc.state),
      foot: "From the Cash Inflow ledger · tracked separately from bank movement and not included in bank totals",
      columns: "minmax(0, 1.5fr) minmax(0, 1fr)", rows: "auto minmax(0, 1fr)",
      sections: [
        place(priv(stats([
          ["GROSS RECEIVED", ok ? money(rc.grossReceived, 0) : null, "info"],
          ["RECEIPTS", ok ? rc.receiptCount : null],
          ["AVERAGE RECEIPT", ok && rc.receiptCount ? money(rc.grossReceived! / rc.receiptCount, 0) : null],
          ["DEPOSITED", ok ? `${gross ? Math.round((rc.deposited! / gross) * 100) : 0}%` : null, "good", ok ? money(rc.deposited, 0) : null],
          ["RECORDED SINCE", extra?.recordedSince ?? null],
          ["LATEST AS OF", rc.asOf],
        ])), "1 / -1"),
        sec("DEPOSIT STATUS", ok ? table(["STATUS", "AMOUNT", "SHARE", "", "MEANING"], parts.map(([label, value, tone, meaning]) => [
          [label, tone], money(value, 2), `${gross ? (((value ?? 0) / gross) * 100).toFixed(1) : "0.0"}%`, bar(gross ? (value ?? 0) / gross : 0, tone), meaning,
        ]), [1, 2], [1]) : note("Cash inflow ledger unavailable.")),
        sec("LATEST RECEIPT", extra?.latestAmount ? priv(stats([
          ["AMOUNT", money(extra.latestAmount, 2), "info"],
          ["RECEIVED", extra.latestDate],
          ["DEPOSIT", extra.latestStatus, extra.latestStatus === "DEPOSITED" ? "good" : extra.latestStatus === "UNDEPOSITED" ? "warn" : "muted"],
        ], 3)) : note("No receipt recorded yet this year."),
        note("Receipt amounts, payers, and documents stay in the ledger; this console shows sanitized totals only."),
        linkButton("OPEN BUSINESS CONTROL", "/business-canary.html")),
      ],
    };
  },

  changes(previous, next) {
    const before = previous.receipts.receiptCount, after = next.receipts.receiptCount;
    return before !== null && after !== null && after > before
      ? [{ tone: "good", kicker: "BUSINESS", text: `${after - before} new receipt${after - before === 1 ? "" : "s"} recorded` }] : [];
  },
};

/* ---------------- ledger review queue ---------------- */

const REVIEW_GUIDE: Record<string, [string, string]> = {
  missingReceipts: ["Expenses without an attached receipt.", "Attach the receipt to the ledger row."],
  classificationGaps: ["Transactions without a deduction category.", "Assign the Schedule C category."],
  incompleteMileage: ["Trips missing distance, purpose, or vehicle.", "Complete the mileage log entry."],
  assetsAwaitingReview: ["Purchases that may need asset or depreciation treatment.", "Confirm expense vs. asset treatment."],
  appWorkflowExceptions: ["Mobile intake items that failed validation.", "Re-submit or resolve in the intake app."],
};

export const reviewModule: Manifest = {
  ...base,
  id: "business-review",
  title: "LEDGER REVIEW QUEUE",
  description: "Open items in the 2026 deductions ledger: missing receipts, classification gaps, mileage, assets, and intake exceptions.",

  render(body, m) {
    const rv = m.review;
    const ok = visible(rv.state);
    const value = el("div", "kpi-value", ok ? pad2(rv.totalOpen) : "—");
    setTone(value, ok ? (rv.totalOpen ? "warn" : "good") : "muted");
    const max = Math.max(1, ...REVIEW_ROWS.map(([key]) => (ok ? rv[key] ?? 0 : 0)));
    const bars = el("div", "hbars");
    bars.append(...REVIEW_ROWS.map(([key, label]) => {
      const n = ok ? rv[key] ?? 0 : null;
      const row = el("div", "hbar");
      const fill = el("i");
      fill.style.setProperty("--w", `${n ? (n / max) * 100 : 0}%`);
      setTone(fill, n ? "warn" : "good");
      row.append(el("span", "", label), fill, el("b", "", n === null ? "—" : String(n)));
      return row;
    }));
    body.replaceChildren(value, el("div", "kpi-sub", "open items · 2026 deductions ledger"), bars);
  },

  ticker: (m) => (visible(m.review.state) ? [{ label: "BOOKS", value: `${m.review.totalOpen} ledger items open`, order: 13 }] : []),

  chip: (m) => (visible(m.review.state) ? { label: m.review.totalOpen ? "NEEDS REVIEW" : "CLEAR", tone: m.review.totalOpen ? "warn" : "good" } : { label: "UNAVAILABLE", tone: "muted" }),

  detail(m) {
    const rv = m.review;
    const ok = visible(rv.state);
    const max = Math.max(1, ...REVIEW_ROWS.map(([k]) => (ok ? rv[k] ?? 0 : 0)));
    return {
      title: "LEDGER REVIEW QUEUE",
      chip: ok ? { label: rv.totalOpen ? `${rv.totalOpen} OPEN` : "CLEAR", tone: rv.totalOpen ? "warn" : "good" } : { label: "UNAVAILABLE", tone: "muted" },
      foot: `AP3X Operations LLC 2026 Deductions Ledger · cash basis${rv.generatedAt ? ` · generated ${ageLabel(sinceMs(rv.generatedAt, m.now))}` : ""}`,
      columns: "minmax(0, 1fr)", rows: "auto minmax(0, 1fr)",
      sections: [
        stats([["TOTAL OPEN", ok ? rv.totalOpen : null, ok ? (rv.totalOpen ? "warn" : "good") : "muted"],
          ...REVIEW_ROWS.map(([k, label]) => [label, ok ? rv[k] : null, ok ? (rv[k] ? "warn" : "good") : "muted"] as [string, number | null, Tone])], 6),
        sec("WHAT EACH ITEM MEANS AND HOW TO CLEAR IT",
          ok ? table(["CATEGORY", "OPEN", "", "WHAT IT IS", "HOW TO CLEAR"], REVIEW_ROWS.map(([k, label]) => [
            [label, rv[k] ? "warn" : "good"], rv[k], bar((rv[k] ?? 0) / max, rv[k] ? "warn" : "good"), REVIEW_GUIDE[k]![0], REVIEW_GUIDE[k]![1],
          ]), [1]) : note("Ledger review source unavailable."),
          linkButton("OPEN BUSINESS CONTROL", "/business-canary.html")),
      ],
    };
  },

  priority(m) {
    const rv = m.review;
    if (!visible(rv.state) || !rv.totalOpen) return null;
    return {
      rank: 35, kicker: "BUSINESS / BOOKS", title: `${rv.totalOpen} ledger item${rv.totalOpen === 1 ? "" : "s"} awaiting review`,
      summary: `${rv.missingReceipts ?? 0} receipts · ${rv.classificationGaps ?? 0} classification · ${rv.incompleteMileage ?? 0} mileage`, posture: "REVIEW", tone: "warn",
    };
  },

  changes(previous, next) {
    const a = previous.review.totalOpen, b = next.review.totalOpen;
    if (a === null || b === null || a === b) return [];
    return [b < a ? { tone: "good", kicker: "BOOKS", text: `Review queue down to ${b}` } : { tone: "warn", kicker: "BOOKS", text: `Review queue up to ${b}` }];
  },
};

/* ---------------- cash flow chart + weekly trend ---------------- */

export const cashflowModule: Manifest = {
  ...base,
  id: "business-cashflow",
  title: "CASH FLOW · DAILY IN / OUT",
  description: "Daily business money in and out over 30 days with the running net, and a week-by-week breakdown in detail.",

  render(body, m) {
    const legend = el("ul", "legend legend-inline");
    for (const [label, tone] of [["MONEY IN", "good"], ["MONEY OUT", "bad"], ["CUMULATIVE NET", "info"]] as const) {
      const li = el("li");
      const dot = el("i", "dot");
      setTone(dot, tone);
      li.append(dot, label);
      legend.append(li);
    }
    body.replaceChildren(cashflowChart(visible(m.bank.state) ? m.daily : []), legend);
  },

  chip: (m) => (visible(m.bank.state) ? { label: `${m.daily.length} DAYS`, tone: "info" } : { label: "UNAVAILABLE", tone: "muted" }),

  detail(m) {
    const ok = visible(m.bank.state);
    const weeks = ok ? weeksFromDaily(m.daily) : [];
    const current = weeks[weeks.length - 1], prior = weeks[weeks.length - 2];
    const full = weeks.filter((w) => w.days === 7);
    const avg = full.length ? full.reduce((s, w) => s + w.net, 0) / full.length : null;
    const max = Math.max(1, ...weeks.map((x) => Math.abs(x.net)));
    return {
      title: "WEEKLY BUSINESS TREND",
      chip: ok ? { label: `${weeks.length} WEEKS`, tone: "info" } : { label: "BANK UNAVAILABLE", tone: "muted" },
      foot: "Bank weeks run Monday–Sunday from the 30-day bank feed · partial weeks at either end are marked with their day count",
      columns: "minmax(0, 1.2fr) minmax(0, 1fr)", rows: "auto minmax(0, 1fr)",
      sections: [
        place(priv(stats([
          ["THIS WEEK NET", current ? signedMoney(current.net, 0) : null, current ? (current.net < 0 ? "bad" : "good") : "muted", current ? `${current.days} day${current.days === 1 ? "" : "s"} so far` : null],
          ["LAST WEEK NET", prior ? signedMoney(prior.net, 0) : null, prior ? (prior.net < 0 ? "bad" : "good") : "muted"],
          ["WEEK OVER WEEK", current && prior ? signedMoney(current.net - prior.net, 0) : null, current && prior ? (current.net >= prior.net ? "good" : "warn") : "muted", "this week vs last"],
          ["AVG FULL WEEK", avg === null ? null : signedMoney(avg, 0), null, `${full.length} full week${full.length === 1 ? "" : "s"}`],
        ])), "1 / -1"),
        sec("BANK BY WEEK", weeks.length ? table(["WEEK OF", "IN", "OUT", "NET", "", "TXNS", "VS PRIOR"], weeks.slice().reverse().map((w, i, list) => {
          const before = list[i + 1];
          return [`${w.start}${w.days < 7 ? ` · ${w.days}D` : ""}`, [money(w.moneyIn, 0), "good"], [money(w.moneyOut, 0), "bad"], [signedMoney(w.net, 0), w.net < 0 ? "bad" : "good"],
            bar(Math.abs(w.net) / max, w.net < 0 ? "bad" : "good"), w.count, before ? [signedMoney(w.net - before.net, 0), w.net >= before.net ? "good" : "warn"] : "—"];
        }), [1, 2, 3, 5, 6], [1, 2, 3, 6]) : note("Bank activity unavailable.")),
        sec("DAILY IN / OUT · RUNNING NET", cashflowChart(ok ? m.daily : [])),
      ],
    };
  },
};

/* ---------------- obligations: next 60 days ---------------- */

export const obligationsModule: Manifest = {
  ...base,
  id: "business-obligations",
  title: "OBLIGATIONS · NEXT 60 DAYS",
  description: "Open business obligations from the Business Control record on a 60-day timeline, with overdue and due-soon flags.",

  render(body, m) {
    const list = el("ol", "obligations");
    if (!m.obligations.length) list.append(el("li", "empty", m.current.state === "live" ? "No open business obligations recorded." : "Business obligations source unavailable."));
    list.append(...m.obligations.slice(0, 6).map((o) => {
      const li = el("li");
      setTone(li, dueTone(o.days));
      const copy = el("div");
      copy.append(el("b", "", o.title), el("small", "", `${o.due ?? "NO DATE"}${o.owner ? ` · ${o.owner.toUpperCase()}` : ""}`));
      li.append(copy, el("em", "", dueLabel(o.days)));
      return li;
    }));
    body.replaceChildren(obligationTimeline(m.obligations), list);
  },

  ticker: (m) => [
    ...m.obligations.filter((o) => o.days === 0).slice(0, 2).map((o) => ({ label: `DUE ${tonightLabel(m.now)}`, value: o.title, hot: true, order: 4 })),
    ...m.obligations.slice(0, 3).map((o) => ({ label: "DUE", value: `${o.title} · ${dueLabel(o.days)}`, order: 12 })),
  ],

  chip(m) {
    if (m.current.state !== "live") return { label: "UNAVAILABLE", tone: "muted" };
    const overdue = m.obligations.filter((o) => o.days !== null && o.days < 0).length;
    const soon = m.obligations.filter((o) => o.days !== null && o.days >= 0 && o.days <= 14).length;
    return { label: `${m.obligations.length} OPEN${overdue ? ` · ${overdue} OVERDUE` : soon ? ` · ${soon} ≤14D` : ""}`, tone: overdue ? "bad" : soon ? "warn" : "good" };
  },

  detail(m) {
    const all = m.obligations;
    const live = m.current.state === "live";
    const groups: [string, typeof all, Tone][] = [
      ["OVERDUE", all.filter((o) => o.days !== null && o.days < 0), "bad"],
      ["NEXT 7 DAYS", all.filter((o) => o.days !== null && o.days >= 0 && o.days <= 7), "warn"],
      ["8 – 30 DAYS", all.filter((o) => o.days !== null && o.days > 7 && o.days <= 30), "info"],
      ["LATER", all.filter((o) => o.days !== null && o.days > 30), "info"],
      ["NO DATE", all.filter((o) => o.days === null), "muted"],
    ];
    const column = (title: string, list: typeof all, tone: Tone) => {
      const head = el("div", "dgroup-title", `${title} · ${list.length}`);
      setTone(head, tone);
      return sec(null, head, list.length ? dlist(list.map((o) => ({ title: o.title, detail: `${o.due ?? "No date"}${o.owner ? ` · ${o.owner}` : ""}`, tag: dueLabel(o.days), tone: dueTone(o.days) }))) : note("Nothing here."));
    };
    return {
      title: "BUSINESS OBLIGATIONS",
      chip: this.chip!(m),
      foot: `Owner-maintained Business Control record${m.current.sourceAgeMs !== null ? ` · edited ${ageLabel(m.current.sourceAgeMs)}` : ""}`,
      columns: "repeat(5, minmax(0, 1fr))", rows: "auto minmax(0, 1fr)",
      sections: [
        place(stats([
          ["OPEN", live ? all.length : null],
          ["OVERDUE", live ? groups[0]![1].length : null, groups[0]![1].length ? "bad" : "good"],
          ["NEXT 7 DAYS", live ? groups[1]![1].length : null, groups[1]![1].length ? "warn" : "good"],
          ["NEXT 30 DAYS", live ? groups[1]![1].length + groups[2]![1].length : null],
          ["NEXT DUE", all[0] ? dueLabel(all[0].days) : null, all[0] ? dueTone(all[0].days) : "muted", all[0]?.title],
        ]), "1 / -1"),
        ...groups.map(([title, list, tone]) => column(title, list, tone)),
      ],
    };
  },

  priority(m) {
    const overdue = m.obligations.filter((o) => o.days !== null && o.days < 0);
    if (overdue.length) {
      return { rank: 85, kicker: "BUSINESS / OBLIGATION", title: overdue[0]!.title,
        summary: `${overdue.length} business obligation${overdue.length === 1 ? "" : "s"} overdue · ${dueLabel(overdue[0]!.days)}`, posture: "OVERDUE", tone: "bad" };
    }
    const soon = m.obligations.find((o) => o.days !== null && o.days <= 7);
    return soon ? { rank: 52, kicker: "BUSINESS / NEXT DUE", title: soon.title, summary: `${dueLabel(soon.days)}${soon.owner ? ` · owner ${soon.owner}` : ""}`, posture: "DUE SOON", tone: "warn" } : null;
  },

  changes(previous, next) {
    const was = new Set(previous.obligations.filter((o) => o.days !== null && o.days < 0).map((o) => o.title));
    return next.obligations.filter((o) => o.days !== null && o.days < 0 && !was.has(o.title)).slice(0, 3)
      .map((o) => ({ tone: "bad" as Tone, kicker: "BUSINESS", text: `${o.title} is overdue` }));
  },
};

/* ---------------- latest receipt (and its split) ---------------- */

export const allocationModule: Manifest = {
  ...base,
  id: "business-allocation",
  title: "LATEST RECEIPT",
  description: "The most recent receipt from the Cash Inflow ledger and, when one is recorded, how it was split across reserves and payments.",

  render(body, m) {
    const alloc = m.allocation;
    const wrap = el("div", "donut-wrap");
    const center = el("div", "donut-center");
    center.append(priv(el("b", "", alloc?.amount ? money(alloc.amount, alloc.parts ? 0 : 2) : "—")),
      el("span", "", alloc?.date ? `${alloc.parts ? "SPLIT" : "RECEIVED"} ${alloc.date}` : "LATEST RECEIPT"));
    wrap.append(donut(alloc?.parts ?? []), center);
    const legend = el("ul", "legend");
    if (alloc?.parts) {
      legend.append(...alloc.parts.map((part) => {
        const li = el("li");
        const dot = el("i", "dot");
        dot.style.background = part.color;
        li.append(dot, el("span", "", part.label), priv(el("b", "", money(part.value, 0))));
        return li;
      }));
    } else {
      // A receipt with no split recorded (e.g. a paycheck already spent) is simply received.
      legend.append(el("li", "", alloc ? "Received · no split recorded" : "No receipt available."));
    }
    const grid = el("div", "alloc");
    grid.append(wrap, legend);
    body.replaceChildren(grid);
  },

  chip: (m) => (m.allocation?.parts ? { label: "CONFIRMED", tone: "good" } : m.allocation ? { label: "RECEIVED", tone: "good" } : { label: "UNAVAILABLE", tone: "muted" }),

  detail(m) {
    const alloc = m.allocation;
    const parts = alloc?.parts ?? [];
    const total = parts.reduce((s, p) => s + p.value, 0) || 1;
    const big = el("div", "donut-big");
    const center = el("div", "donut-center");
    center.append(priv(el("b", "", alloc?.amount ? money(alloc.amount, parts.length ? 0 : 2) : "—")),
      el("span", "", alloc?.date ? `${parts.length ? "SPLIT" : "RECEIVED"} ${alloc.date}` : "LATEST RECEIPT"));
    big.append(donut(parts, 80), center);
    return {
      title: "LATEST RECEIPT",
      chip: alloc?.parts ? { label: "SPLIT RECORDED", tone: "good" } : this.chip!(m),
      foot: "Most recent counted receipt from the Cash Inflow ledger · a split is shown only when one is recorded",
      columns: "minmax(0, 1fr) minmax(0, 1.3fr)", rows: "minmax(0, 1fr)",
      sections: [
        sec(parts.length ? "SPLIT" : "RECEIPT", big),
        sec(parts.length ? "WHERE IT WENT" : "DETAIL", parts.length ? table(["BUCKET", "AMOUNT", "SHARE", ""], parts.map((p) => {
          const label = el("span");
          const dot = el("i", "dot");
          dot.style.background = p.color;
          label.append(dot, ` ${p.label}`);
          return [label, money(p.value, 2), `${((p.value / total) * 100).toFixed(1)}%`, bar(p.value / total, p.label === "UNALLOCATED" ? "warn" : "info")];
        }), [1, 2], [1]) : note(alloc ? "Received in full. No split was recorded for this receipt, and none is required." : "No receipt available."),
        parts.find((p) => p.label === "UNALLOCATED")?.value ? note("Part of this receipt has no bucket recorded; that is informational only.") : null),
      ],
    };
  },
};

/* ---------------- books health ---------------- */

type Check = [title: string, ok: boolean | null, detail: string, fix: string, short: string];

function checks(m: BusinessModel): Check[] {
  const { review: rv, receipts: rc, bank } = m;
  const overdue = m.obligations.filter((o) => o.days !== null && o.days < 0);
  return [
    ["Business sources current", m.mode === "demo" || m.state === "live", "All four business feeds (record, ledger, receipts, bank) are fresh.",
      "If stale, check the ledger synchronizer timer and the bank connection.", m.state === "unknown" ? "UNKNOWN" : m.state.toUpperCase()],
    ["No overdue obligations", m.current.state === "live" ? overdue.length === 0 : null, overdue.length ? `Overdue: ${overdue.map((o) => o.title).join(", ")}` : "Every dated obligation is on time.",
      "Complete or reschedule the overdue item in Business Control.", m.current.state === "live" ? (overdue.length ? `${overdue.length} OVERDUE` : "CLEAR") : "UNKNOWN"],
    ["Ledger review queue clear", visible(rv.state) ? rv.totalOpen === 0 : null, visible(rv.state) ? `${rv.totalOpen} ledger item(s) open.` : "Ledger unavailable.",
      "Work the review queue: receipts, categories, mileage.", visible(rv.state) ? `${rv.totalOpen} OPEN` : "UNKNOWN"],
    ["Receipts all deposited", visible(rc.state) ? rc.undeposited! + rc.depositUnknown! === 0 : null,
      visible(rc.state) ? `${money(rc.undeposited, 0)} undeposited · ${money(rc.depositUnknown, 0)} unknown.` : "Receipts unavailable.",
      "Deposit outstanding receipts and record their status.", visible(rc.state) ? (rc.undeposited! + rc.depositUnknown! ? money(rc.undeposited! + rc.depositUnknown!, 0) : "ALL IN") : "UNKNOWN"],
    ["Bank feed connected", visible(bank.state) ? bank.state === "live" : bank.connected === false ? false : null,
      bank.connected === false ? "Bank connection needs attention." : `Bank feed is ${bank.state}.`,
      "Reconnect the bank in Business Control if it reports reconnect required.", visible(bank.state) ? bank.state.toUpperCase() : bank.connected === false ? "DISCONNECTED" : "UNKNOWN"],
  ];
}

const scoreOf = (list: Check[]) => {
  const scored = list.filter(([, ok]) => ok !== null);
  return scored.length ? Math.round((scored.filter(([, ok]) => ok).length / list.length) * 100) : null;
};
const scoreTone = (score: number | null): Tone => (score === null ? "muted" : score >= 84 ? "good" : score >= 50 ? "warn" : "bad");
const scoreLabel = (score: number | null) => (score === null ? "UNKNOWN" : score >= 84 ? "HEALTHY" : score >= 50 ? "ATTENTION" : "ACTION");

export const healthModule: Manifest = {
  ...base,
  id: "business-health",
  title: "BOOKS HEALTH",
  description: "A simple, explainable books-health score: sources current, no overdue obligations, review queue clear, receipts deposited, bank connected.",

  render(body, m) {
    const list = checks(m);
    const score = scoreOf(list);
    const head = el("div", "health-score");
    const value = el("b", "", score === null ? "—" : String(score));
    setTone(value, scoreTone(score));
    head.append(value, el("span", "", "/ 100"));
    const ul = el("ul", "checklist");
    ul.append(...list.map(([label, ok, , , short]) => {
      const li = el("li");
      setTone(li, ok === null ? "muted" : ok ? "good" : "warn");
      li.append(el("i", "", ok === null ? "?" : ok ? "✓" : "!"), el("span", "", label), priv(el("b", "", short)));
      return li;
    }));
    const sources = el("ul", "biz-sources");
    const sourceState = (state: string): [string, Tone] => (state === "live" ? ["CURRENT", "good"] : state === "stale" ? ["STALE", "warn"] : state === "partial" ? ["PARTIAL", "warn"] : ["UNKNOWN", "muted"]);
    sources.append(...([["BUSINESS", m.current.state], ["LEDGER", m.review.state], ["RECEIPTS", m.receipts.state], ["BANKING", m.bank.state]] as const).map(([label, state]) => {
      const [text, tone] = sourceState(state);
      const li = el("li");
      setTone(li, tone);
      li.append(el("span", "", label), el("b", "", text));
      return li;
    }));
    body.replaceChildren(head, ul, sources);
  },

  chip(m) {
    const score = scoreOf(checks(m));
    return { label: scoreLabel(score), tone: scoreTone(score) };
  },

  detail(m) {
    const list = checks(m);
    const score = scoreOf(list);
    const scored = list.filter(([, ok]) => ok !== null);
    return {
      title: "BOOKS HEALTH",
      chip: { label: scoreLabel(score), tone: scoreTone(score) },
      foot: "Each check is worth an equal share of the score · unknown checks count as not passed",
      columns: "minmax(0, 1fr)", rows: "auto minmax(0, 1fr)",
      sections: [
        stats([["SCORE", score === null ? null : `${score} / 100`, scoreTone(score)], ["PASSING", scored.filter(([, ok]) => ok).length],
          ["NEEDS WORK", scored.filter(([, ok]) => !ok).length, "warn"], ["UNKNOWN", list.length - scored.length, "muted"]], 4),
        sec("CHECKS", priv(dlist(list.map(([title, ok, detail, fix]) => ({
          title, detail: ok ? detail : `${detail} → ${fix}`, tag: ok === null ? "UNKNOWN" : ok ? "PASS" : "FIX", tone: ok === null ? "muted" : ok ? "good" : "warn",
        }))))),
      ],
    };
  },
};

export const businessModules = [bankModule, receiptsModule, reviewModule, cashflowModule, healthModule, obligationsModule, allocationModule];
