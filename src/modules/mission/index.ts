import { el, setTone } from "../../core/dom";
import type { ModuleManifest, Tone } from "../../core/types";
import { summarizeBusinessCurrent, summarizeReview } from "../business/summaries";
import { demoBusiness } from "../business/model";
import { labModule, parseLab, PRINTERS_SOURCE } from "../lab";
import { nodesModule, NODE_STATUS_SOURCE, parseNodes } from "../nodes";
import { missionLabModule, ownedLabDevices } from "./lab";
import { missionWorkModule } from "./work";
import "./mission.css";

type PageKey = "work" | "business" | "lab" | "systems";
interface MissionSettings extends Record<string, unknown> {
  pages: Record<PageKey, string>;
}
interface MissionCard {
  key: PageKey;
  label: string;
  value: string;
  detail: string;
  tone: Tone;
  page: string | null;
  known: boolean;
}
interface MissionModel {
  headline: string;
  alerts: number;
  known: number;
  cards: MissionCard[];
}

const FOCUS_MS = 25 * 60_000;
interface FocusState {
  mode: "idle" | "running" | "paused" | "done";
  remainingMs: number;
  endsAt: number | null;
  timer: ReturnType<typeof setInterval> | null;
}
const focusStates = new WeakMap<HTMLElement, FocusState>();

function focusState(body: HTMLElement): FocusState {
  let state = focusStates.get(body);
  if (!state) {
    state = { mode: "idle", remainingMs: FOCUS_MS, endsAt: null, timer: null };
    focusStates.set(body, state);
  }
  return state;
}

function updateFocus(body: HTMLElement, state: FocusState): void {
  if (state.mode === "running" && state.endsAt !== null) {
    state.remainingMs = Math.max(0, state.endsAt - Date.now());
    if (state.remainingMs === 0) {
      state.mode = "done";
      state.endsAt = null;
    }
  }
  const seconds = Math.ceil(state.remainingMs / 1000);
  const clock = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const time = body.querySelector<HTMLElement>(".mission-focus-time");
  const status = body.querySelector<HTMLElement>(".mission-focus-status");
  const toggle = body.querySelector<HTMLButtonElement>(".mission-focus-toggle");
  if (time) time.textContent = clock;
  if (status) status.textContent = ({ idle: "READY", running: "FOCUS RUNNING", paused: "PAUSED", done: "SESSION COMPLETE" } as const)[state.mode];
  if (toggle) toggle.textContent = ({ idle: "START", running: "PAUSE", paused: "RESUME", done: "AGAIN" } as const)[state.mode];
}

function mountFocus(body: HTMLElement): HTMLElement {
  const state = focusState(body);
  const wrap = el("div", "mission-focus");
  const label = el("div", "mission-focus-label");
  label.append(el("b", "", "FOCUS 25"), el("small", "mission-focus-status"));
  const time = el("strong", "mission-focus-time");
  const toggle = el("button", "mission-focus-toggle");
  toggle.type = "button";
  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    if (state.mode === "running") {
      state.remainingMs = Math.max(0, (state.endsAt ?? Date.now()) - Date.now());
      state.endsAt = null;
      state.mode = "paused";
    } else {
      if (state.mode === "done") state.remainingMs = FOCUS_MS;
      state.endsAt = Date.now() + state.remainingMs;
      state.mode = "running";
    }
    updateFocus(body, state);
  });
  const reset = el("button", "mission-focus-reset", "RESET");
  reset.type = "button";
  reset.addEventListener("click", (event) => {
    event.stopPropagation();
    state.mode = "idle";
    state.endsAt = null;
    state.remainingMs = FOCUS_MS;
    updateFocus(body, state);
  });
  wrap.append(label, time, toggle, reset);
  if (!state.timer) {
    state.timer = setInterval(() => {
      if (!body.isConnected) {
        clearInterval(state.timer!);
        state.timer = null;
        focusStates.delete(body);
      } else updateFocus(body, state);
    }, 1000);
  }
  return wrap;
}

/** An AP3X decision surface for the 800×480 personal touchscreen. All external feeds stay read-only. */
export const missionHomeModule: ModuleManifest<MissionModel, MissionSettings> = {
  id: "mission-home",
  title: "TODAY",
  description: "AP3X obligations, ledger review, lab, and machines with page shortcuts and a local focus timer.",
  version: "1.0.0",
  defaults: { pages: { work: "work", business: "business", lab: "lab", systems: "systems" } },
  sources: [
    ...missionWorkModule.sources,
    PRINTERS_SOURCE,
    NODE_STATUS_SOURCE,
  ],

  model(ctx) {
    const current = summarizeBusinessCurrent(ctx.sources["business-record"]?.data, ctx.now);
    const review = summarizeReview(ctx.sources.ledger?.data, ctx.now);
    const lab = ownedLabDevices(parseLab(ctx.sources.printers?.data, ctx.now));
    const nodes = parseNodes(ctx.sources["node-status"]?.data, ctx.now, []);
    const rawPages: unknown = ctx.settings.pages;
    const pages: Record<string, unknown> = rawPages && typeof rawPages === "object" ? rawPages as Record<string, unknown> : {};
    const page = (key: PageKey): string | null => typeof pages[key] === "string" ? pages[key] : null;
    const workAny = current.state !== "unknown" || review.state !== "unknown";
    const workKnown = current.state === "live" && review.state === "live";
    const booksKnown = review.state === "live";
    const bizOverdue = current.overdue ?? 0;
    const reviewOpen = review.totalOpen ?? 0;
    const online = nodes.nodes.filter((node) => node.state === "ONLINE").length;
    const offline = nodes.nodes.filter((node) => node.state === "OFFLINE").length;
    const cards: MissionCard[] = [
      {
        key: "work", label: "AP3X WORK", page: page("work"), known: workKnown,
        value: workAny ? `${bizOverdue + reviewOpen} TO REVIEW` : "—",
        detail: workAny ? `${current.overdue === null ? "?" : bizOverdue} deadlines · ${review.totalOpen === null ? "?" : reviewOpen} ledger` : "Obligations and ledger unavailable",
        tone: !workAny ? "muted" : bizOverdue > 0 ? "bad" : reviewOpen > 0 || !workKnown ? "warn" : "good",
      },
      {
        key: "business", label: "BOOKS", page: page("business"), known: booksKnown,
        value: review.totalOpen === null ? "—" : `${reviewOpen} OPEN`,
        detail: review.state === "unknown" ? "Ledger review unavailable" : review.state === "stale" ? "Ledger feed stale" : "Sanitized ledger review queue",
        tone: review.state === "unknown" ? "muted" : review.state === "stale" || reviewOpen > 0 ? "warn" : "good",
      },
      {
        key: "lab", label: "X1C + M7", page: page("lab"), known: lab.status === "LIVE" && lab.devices.length === 2,
        value: lab.status === "NO FEED" || !lab.devices.length ? "—" : lab.errors ? `${lab.errors} ERROR`
          : lab.active ? `${lab.active} ACTIVE` : lab.devices.length < 2 ? `${lab.devices.length}/2 IN FEED` : "0 ACTIVE",
        detail: lab.status === "NO FEED" ? "Printer feed unavailable" : lab.status === "STALE" ? "Printer feed stale" : `${lab.devices.length}/2 in feed · ${lab.offline} offline`,
        tone: lab.status === "NO FEED" || !lab.devices.length ? "muted" : lab.errors ? "bad" : lab.status === "STALE" || lab.devices.length < 2 ? "warn" : lab.active ? "info" : "good",
      },
      {
        key: "systems", label: "SYSTEMS", page: page("systems"), known: nodes.status !== "NO FEED" && nodes.nodes.length > 0,
        value: nodes.status === "NO FEED" || !nodes.nodes.length ? "—" : `${online}/${nodes.nodes.length} ONLINE`,
        detail: nodes.status === "NO FEED" ? "Machine feed unavailable" : nodes.status === "STALE" ? "Machine feed stale" : offline ? `${offline} offline` : "No offline machines reported",
        tone: nodes.status === "NO FEED" || !nodes.nodes.length ? "muted" : nodes.status === "STALE" ? "warn" : offline ? "bad" : "good",
      },
    ];
    const alerts = bizOverdue + reviewOpen + (lab.status === "NO FEED" ? 0 : lab.errors) + offline;
    const known = cards.filter((card) => card.known).length;
    return {
      cards, alerts, known,
      headline: alerts ? `${alerts} ITEMS NEED ATTENTION` : known < cards.length ? "PARTIAL VIEW · CHECK FEEDS" : "NO URGENT ITEMS REPORTED",
    };
  },

  render(body, model) {
    const intro = el("div", "mission-intro");
    intro.append(el("span", "", "AP3X · PERSONAL COMMAND"), el("b", "", model.headline));
    const cards = el("div", "mission-cards");
    cards.append(...model.cards.map((item) => {
      const card = el("button", "mission-card");
      card.type = "button";
      setTone(card, item.tone);
      card.append(el("span", "", item.label), el("b", "", item.value), el("small", "", item.detail));
      if (item.page) {
        card.setAttribute("aria-label", `Open ${item.label}: ${item.value}, ${item.detail}`);
        card.addEventListener("click", (event) => {
          event.stopPropagation();
          body.dispatchEvent(new CustomEvent("console-page", { bubbles: true, detail: item.page }));
        });
      } else card.disabled = true;
      return card;
    }));
    body.replaceChildren(intro, cards, mountFocus(body));
    updateFocus(body, focusState(body));
  },

  chip: (model) => model.alerts ? { label: `${model.alerts} ATTENTION`, tone: "warn" }
    : model.known < model.cards.length ? { label: "PARTIAL FEEDS", tone: "muted" } : { label: "READY", tone: "good" },

  demo(now) {
    return { ...demoBusiness(now), ...(labModule.demo?.(now) ?? {}), ...(nodesModule.demo?.(now) ?? {}) };
  },
};

export { missionLabModule, missionWorkModule };
