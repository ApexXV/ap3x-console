import { el, privateText, setTone } from "../../core/dom";
import { asDict, daysUntil, rows, text } from "../../core/format";
import type { ModuleManifest, Tone } from "../../core/types";
import { BUSINESS_SOURCES, demoBusiness } from "../business/model";
import { summarizeBusinessCurrent, summarizeReview } from "../business/summaries";

interface Obligation {
  title: string;
  due: string | null;
  days: number | null;
  priority: number;
}
interface ReviewItem { label: string; count: number }
interface WorkModel {
  currentState: string;
  reviewState: string;
  open: number | null;
  overdue: number | null;
  review: number | null;
  obligations: Obligation[];
  reviewItems: ReviewItem[];
}

const workSources = BUSINESS_SOURCES.filter((source) => source.id === "business-record" || source.id === "ledger");

function dueText(days: number | null): string {
  if (days === null) return "NO DATE";
  if (days < 0) return `${-days}D LATE`;
  if (days === 0) return "TODAY";
  return `IN ${days}D`;
}
function dueTone(days: number | null): Tone {
  return days === null ? "muted" : days < 0 ? "bad" : days <= 7 ? "warn" : "info";
}

/** AP3X obligations and sanitized ledger review queue, designed for one touch page. */
export const missionWorkModule: ModuleManifest<WorkModel> = {
  id: "mission-work",
  title: "AP3X WORK",
  description: "Open business obligations and sanitized ledger review categories; never shows transaction detail.",
  version: "1.0.0",
  sources: workSources,

  model(ctx) {
    const business = ctx.sources["business-record"]?.data;
    const ledger = ctx.sources.ledger?.data;
    const current = summarizeBusinessCurrent(business, ctx.now);
    const review = summarizeReview(ledger, ctx.now);
    const businessRetained = ["retained", "stale"].includes(ctx.sources["business-record"]?.status ?? "");
    const ledgerRetained = ["retained", "stale"].includes(ctx.sources.ledger?.status ?? "");
    const currentState = current.state === "unknown" ? "unknown" : businessRetained ? "stale" : current.state;
    const reviewState = review.state === "unknown" ? "unknown" : ledgerRetained ? "stale" : review.state;
    const obligations = current.state === "live" ? rows(asDict(business).deadlines)
      .filter((row) => row.active !== false && row.complete !== true)
      .map((row) => {
        const due = typeof row.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.due) ? row.due : null;
        return {
          title: (text(row.short_label, row.label) ?? "Business obligation").slice(0, 90),
          due,
          days: daysUntil(due, ctx.now),
          priority: typeof row.priority === "number" && Number.isFinite(row.priority) ? row.priority : 0,
        };
      })
      .sort((a, b) => (a.due === null ? 1 : b.due === null ? -1 : a.due.localeCompare(b.due)) || b.priority - a.priority)
      .slice(0, 5) : [];
    const reviewItems: ReviewItem[] = review.state === "unknown" ? [] : [
      { label: "MISSING RECEIPTS", count: review.missingReceipts ?? 0 },
      { label: "MILEAGE", count: review.incompleteMileage ?? 0 },
      { label: "CLASSIFICATION", count: review.classificationGaps ?? 0 },
      { label: "ASSETS", count: review.assetsAwaitingReview ?? 0 },
      { label: "WORKFLOW", count: review.appWorkflowExceptions ?? 0 },
    ].filter((item) => item.count > 0);
    return {
      currentState,
      reviewState,
      open: current.openDeadlines,
      overdue: current.overdue,
      review: review.totalOpen,
      obligations,
      reviewItems,
    };
  },

  render(body, model) {
    const wrap = el("div", "mission-work");
    const counters = el("div", "mission-work-counters");
    for (const [value, label, tone] of [
      [model.open, "OPEN OBLIGATIONS", "info"],
      [model.overdue, "OVERDUE", model.overdue ? "bad" : "good"],
      [model.review, "LEDGER REVIEW", model.review ? "warn" : "good"],
    ] as [number | null, string, Tone][]) {
      const tile = el("div", "mission-work-count");
      setTone(tile, value === null ? "muted" : tone);
      tile.append(el("b", "", value === null ? "—" : value), el("span", "", label));
      counters.append(tile);
    }
    const lists = el("div", "mission-work-lists");
    const upcoming = el("section");
    upcoming.append(el("h4", "", "NEXT OBLIGATIONS"));
    const obligationList = el("ol", "mission-work-list");
    obligationList.append(...(model.obligations.length ? model.obligations.map((item) => {
      const li = el("li");
      setTone(li, dueTone(item.days));
      li.append(privateText(el("span", "", item.title)), el("em", "", dueText(item.days)));
      return li;
    }) : [el("li", "mission-work-empty", model.currentState === "unknown" ? "Obligations unavailable" : model.currentState === "stale" ? "Business feed stale" : "No open obligations")]));
    upcoming.append(obligationList);
    const ledger = el("section");
    ledger.append(el("h4", "", "LEDGER QUEUE"));
    const reviewList = el("ol", "mission-work-list");
    reviewList.append(...(model.reviewItems.length ? model.reviewItems.map((item) => {
      const li = el("li");
      setTone(li, "warn");
      li.append(el("span", "", item.label), el("em", "", item.count));
      return li;
    }) : [el("li", "mission-work-empty", model.reviewState === "unknown" ? "Review feed unavailable" : model.reviewState === "stale" ? "Ledger feed stale" : "No ledger reviews open")]));
    ledger.append(reviewList);
    lists.append(upcoming, ledger);
    wrap.append(counters, lists);
    body.replaceChildren(wrap);
  },

  chip(model) {
    const total = (model.overdue ?? 0) + (model.review ?? 0);
    if (model.currentState === "unknown" || model.reviewState === "unknown") return { label: "PARTIAL FEEDS", tone: "muted" };
    if (model.currentState === "stale" || model.reviewState === "stale") return { label: "FEED STALE", tone: "warn" };
    if (total) return { label: `${total} TO REVIEW`, tone: "warn" };
    return { label: "CURRENT", tone: "good" };
  },

  demo: demoBusiness,
};
