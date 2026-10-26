import { button, el, privateText, setTone } from "../../core/dom";
import { dlist, note, place, sec, stats } from "../../core/detail";
import { ageLabel, asDict, clockOf, daysUntil, dueLabel, dueTone, num, rows, sinceMs, text, toneFor } from "../../core/format";
import { tonightLabel } from "../../core/ticker";
import type { DetailHooks, ModuleManifest, Tone } from "../../core/types";
import "./fm.css";

/* ClickUp project summary (AP3X-CLICKUP-WALL-1) from the ClickUp bridge: counts, next deadlines,
 * Lists with open work, your @mentions and recent comms. Read-only; excerpts blur in privacy mode. */

export interface FmTask { title: string; project: string | null; status: string | null; due: string | null; days: number | null; time: string | null; overdue: boolean; priority: string | null; mine: boolean; assignees: string[] }
export interface FmComm { author: string; text: string; at: string | null; source: string; task: string | null; mine: boolean; kind: string | null }
export interface FmModel {
  state: string; ageMs: number | null;
  counts: { open: number | null; overdue: number | null; dueSoon: number | null; high: number | null; flags: number | null; mentions: number | null; mentionsPending: number };
  projects: { name: string; open: number; overdue: number; tasks: FmTask[] }[];
  upcoming: FmTask[]; mentions: FmComm[]; recent: FmComm[];
  flags: { title: string; severity: string; candidate: boolean; at: string | null }[];
}

const STALE_MS = 5 * 60_000;
const VISIBLE = new Set(["LIVE", "PARTIAL", "BASELINE", "STALE", "OFFLINE"]);

export function parseFm(payload: unknown, now: number): FmModel {
  const feed = asDict(payload);
  const empty: FmModel = { state: "NO FEED", ageMs: null, counts: { open: null, overdue: null, dueSoon: null, high: null, flags: null, mentions: null, mentionsPending: 0 }, projects: [], upcoming: [], mentions: [], recent: [], flags: [] };
  if (feed.schema_version !== "AP3X-CLICKUP-WALL-1") return { ...empty, state: payload ? "INVALID" : "NO FEED" };
  const ageMs = sinceMs(feed.generated_at, now);
  const health = (text(feed.state) ?? "UNKNOWN").toUpperCase();
  const counts = asDict(feed.counts);
  const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const task = (t: Record<string, unknown>): FmTask => {
    const due = day(t.due_date);
    return {
      title: text(t.title) ?? "Untitled task", project: text(t.project), status: text(t.status), due, days: daysUntil(due, now),
      time: typeof t.due_time === "string" && /^\d{2}:\d{2}$/.test(t.due_time) ? t.due_time : null,
      overdue: t.overdue === true, priority: text(t.priority)?.toUpperCase() ?? null, mine: t.mine === true,
      assignees: Array.isArray(t.assignees) ? t.assignees.map((a) => text(a)).filter((a): a is string => Boolean(a)).slice(0, 3) : [],
    };
  };
  const comm = (c: Record<string, unknown>): FmComm => ({
    author: text(c.author) ?? "Project member", text: text(c.text) ?? "", at: text(c.at), source: text(c.source) ?? "CHAT", task: text(c.task), mine: c.mine === true, kind: text(c.kind),
  });
  return {
    state: ageMs === null || ageMs > STALE_MS ? "STALE" : feed.initializing === true ? "BASELINE" : health === "OK" ? "LIVE" : health,
    ageMs,
    counts: {
      open: num(counts.open), overdue: num(counts.overdue), dueSoon: num(counts.due_soon), high: num(counts.high_priority),
      flags: num(counts.flags_24h), mentions: num(counts.mentions_7d), mentionsPending: num(counts.mentions_pending) ?? 0,
    },
    projects: rows(feed.projects).map((p) => ({ name: text(p.name) ?? "LIST", open: num(p.open) ?? 0, overdue: num(p.overdue) ?? 0, tasks: rows(p.tasks).map(task).slice(0, 15) })).slice(0, 12),
    upcoming: rows(feed.upcoming).map(task).slice(0, 6),
    mentions: rows(feed.mentions).map(comm).filter((c) => c.text).slice(0, 3),
    recent: rows(feed.recent).map(comm).filter((c) => c.text).slice(0, 5),
    flags: rows(feed.flags).map((f) => ({ title: text(f.title) ?? "ClickUp update", severity: (text(f.severity) ?? "info").toUpperCase(), candidate: f.candidate === true, at: text(f.at) })).slice(0, 4),
  };
}

/** "2D OVERDUE", "OVERDUE 09:30" (timed, earlier today), "DUE TODAY 14:00", "IN 3D". */
export function dueText(t: FmTask): string {
  if (t.overdue && (t.days === null || t.days >= 0)) return t.time ? `OVERDUE ${t.time}` : "OVERDUE";
  const label = dueLabel(t.days);
  return t.time && t.days !== null && t.days >= 0 && t.days <= 1 ? `${label} ${t.time}` : label;
}
const taskTone = (t: FmTask): Tone => (t.overdue ? "bad" : dueTone(t.days));

function chipFor(fm: FmModel): { label: string; tone: Tone } {
  if (fm.state === "STALE") return { label: `STALE · ${ageLabel(fm.ageMs)}`, tone: "warn" };
  if (fm.state === "BASELINE") return { label: "BUILDING BASELINE", tone: "info" };
  if (fm.state === "NO FEED" || fm.state === "INVALID") return { label: fm.state === "NO FEED" ? "NO FEED" : "UNREADABLE", tone: "muted" };
  if (fm.state === "LIVE") return { label: fm.counts.overdue ? `${fm.counts.overdue} OVERDUE` : "FM CURRENT", tone: fm.counts.overdue ? "bad" : "good" };
  return { label: fm.state, tone: toneFor(fm.state) };
}

function comms(items: FmComm[], hooks: DetailHooks, now: number): HTMLElement {
  const open = (hooks.state.openComms as Set<string> | undefined) ?? new Set<string>();
  hooks.state.openComms = open;
  const list = el("ol", "dlist fm-comms");
  list.append(...items.map((c) => {
    const key = `${c.at}\u0000${c.author}\u0000${c.text.slice(0, 40)}`;
    const li = el("li", open.has(key) ? "is-clickable is-open" : "is-clickable");
    setTone(li, c.kind ? "warn" : c.mine ? "muted" : "info");
    const copy = el("div");
    copy.append(el("b", "", [c.mine ? "YOU" : c.author, c.kind === "assigned" ? "ASSIGNED TO YOU" : c.source, c.task].filter(Boolean).join(" · ")), privateText(el("small", "", c.text)));
    li.append(copy, el("em", "", c.at ? ageLabel(sinceMs(c.at, now)) : "—"));
    li.title = "Show the full excerpt";
    li.addEventListener("click", (event) => { event.stopPropagation(); if (open.has(key)) open.delete(key); else open.add(key); hooks.rebuild(); });
    return li;
  }));
  return list;
}

export const fmModule: ModuleManifest<FmModel, { title: string }> = {
  id: "clickup",
  title: "FM OPERATIONS · CLICKUP",
  description: "ClickUp project work: open, overdue, and due-soon counts, next deadlines, Lists, your @mentions, and recent comms.",
  version: "1.0.0",
  defaults: { title: "FM OPERATIONS · FINIS MUSICAE" },
  sources: [{ id: "clickup", url: "/clickup-data/current.json", schema: "AP3X-CLICKUP-WALL-1", stampField: "generated_at", maxAgeMs: 15 * 60_000 }],

  model: (ctx) => parseFm(ctx.sources.clickup?.data, ctx.now),

  render(body, fm) {
    const shown = VISIBLE.has(fm.state);
    const c = fm.counts;
    const counters = el("div", "counters fm-counters");
    for (const [value, label, tone] of [[c.open, "OPEN", null], [c.overdue, "OVERDUE", c.overdue ? "bad" : null], [c.dueSoon, "DUE 7D", null], [c.flags, "FLAGS 24H", c.flags ? "warn" : null]] as const) {
      const cell = el("div");
      const b = el("b", "", shown && value !== null ? String(Math.round(value)).padStart(2, "0") : "—");
      if (shown && tone) b.classList.add(`t-${tone}`);
      cell.append(b, el("span", "", label));
      counters.append(cell);
    }
    const next = el("ol", "fm-next");
    const tasks = shown ? fm.upcoming.slice(0, 3) : [];
    next.append(...(tasks.length ? tasks.map((t) => {
      const li = el("li");
      setTone(li, taskTone(t));
      const copy = el("div");
      copy.append(el("b", "", t.title), el("small", "", [t.project, t.status, t.assignees.join(" ")].filter(Boolean).join(" · ")));
      li.append(copy, el("em", "", dueText(t)));
      return li;
    }) : [el("li", "empty", shown ? "No dated open tasks" : fm.state === "NO FEED" ? "Waiting for the ClickUp bridge summary" : "ClickUp summary could not be read")]));
    const wrap = el("div", "fm-body");
    wrap.append(counters, next);
    body.replaceChildren(wrap);
  },

  ticker(fm, ctx) {
    if (!VISIBLE.has(fm.state) || fm.counts.open === null) return [];
    const when = tonightLabel(ctx.now);
    return [
      ...fm.upcoming.filter((t) => t.days === 0 && !t.overdue).slice(0, 2).map((t) => ({ label: `FM ${when}`, value: `${t.title}${t.time ? ` · ${t.time}` : ""}`, hot: true, order: 5 })),
      { label: "FM OPS", value: `${fm.counts.open} open · ${fm.counts.overdue ?? 0} overdue · ${fm.counts.dueSoon ?? 0} due in 7 days`, order: 20 },
      ...fm.upcoming.slice(0, 2).map((t) => ({ label: "FM DUE", value: `${t.title} · ${dueText(t)}`, order: 20 })),
    ];
  },

  chip: chipFor,

  detail(fm, ctx, hooks) {
    const shown = VISIBLE.has(fm.state);
    const c = fm.counts;
    const value = (v: number | null) => (shown ? v : null);
    const small = ctx.stageWidth < 4000;
    const caps = small ? { tasks: 7, mentions: 2, recent: 3, side: 8 } : { tasks: 9, mentions: 3, recent: 5, side: 10 };
    const selectedName = hooks.state.list as string | null | undefined;
    const selected = shown ? fm.projects.find((p) => p.name === selectedName) ?? null : null;
    const items = (list: FmTask[]) => list.map((t) => ({
      title: t.title, tag: t.due ? dueText(t) : "NO DATE", tone: t.due ? taskTone(t) : "muted" as Tone,
      detail: [selected ? null : t.project, t.status, t.priority, t.assignees.length ? t.assignees.join(" ") : null, t.mine ? "ASSIGNED TO YOU" : null].filter(Boolean).join(" · "),
    }));
    const choose = (name: string | null) => { hooks.state.list = name; hooks.rebuild(); };
    const work = selected
      ? sec(`${selected.name} · OPEN TASKS`, selected.tasks.length ? dlist(items(selected.tasks.slice(0, caps.tasks))) : note("No open tasks in this List."),
        selected.open > Math.min(selected.tasks.length, caps.tasks) ? note(`Showing ${Math.min(selected.tasks.length, caps.tasks)} of ${selected.open} open tasks, overdue and earliest due first.`) : null,
        button("ALL DEADLINES", "Back to the next deadlines", () => choose(null)))
      : sec("NEXT DEADLINES", shown && fm.upcoming.length ? dlist(items(fm.upcoming)) : note(shown ? "No open tasks with due dates." : "The ClickUp bridge summary is not available yet."),
        note("Counts cover every open task. Click a List on the right to see its open tasks."));
    const pending = c.mentionsPending ? ` · ${c.mentionsPending} older Chat message${c.mentionsPending === 1 ? "" : "s"} still being checked` : "";
    const projects = fm.projects.slice(0, caps.side);
    const flags = fm.flags.slice(0, Math.max(0, caps.side - projects.length));
    const lists = shown && projects.length ? dlist(projects.map((p) => ({ title: p.name, detail: p.overdue ? `${p.overdue} overdue` : null, tag: `${p.open} OPEN`, tone: p.overdue ? "bad" : "info" }))) : null;
    lists?.querySelectorAll("li").forEach((li, i) => {
      const name = projects[i]!.name;
      li.classList.add("is-clickable");
      li.classList.toggle("is-selected", name === selectedName);
      li.title = `Show ${name} open tasks`;
      li.addEventListener("click", (event) => { event.stopPropagation(); choose(name === selectedName ? null : name); });
    });
    return {
      title: ctx.settings.title, chip: chipFor(fm),
      foot: `ClickUp bridge summary · ${fm.ageMs === null ? "no update yet" : `updated ${ageLabel(fm.ageMs).toLowerCase()}`} · read-only`,
      columns: "minmax(0, 1.2fr) minmax(0, 1.2fr) minmax(0, .9fr)", rows: "auto minmax(0, 1fr)",
      sections: [
        place(stats([["OPEN", value(c.open)], ["OVERDUE", value(c.overdue), c.overdue ? "bad" : "good"], ["DUE IN 7 DAYS", value(c.dueSoon), c.dueSoon ? "warn" : "good"],
          ["HIGH PRIORITY", value(c.high), c.high ? "warn" : "good"], ["@ YOU · 7D", value(c.mentions), c.mentions ? "warn" : "good"], ["FLAGS · 24H", value(c.flags), c.flags ? "warn" : "good"]], 6), "1 / -1"),
        work,
        sec("MENTIONS · YOU",
          shown && fm.mentions.length ? comms(fm.mentions.slice(0, caps.mentions), hooks, ctx.now) : note(shown ? `No @mentions of you in the last 30 days${pending}.` : "Waiting for the ClickUp bridge summary."),
          shown && fm.mentions.length && pending ? note(pending.slice(3)) : null,
          el("h4", "", "LATEST COMMS"),
          shown && fm.recent.length ? comms(fm.recent.slice(0, caps.recent), hooks, ctx.now) : note("No messages in the last 30 days.")),
        sec("LISTS · OPEN WORK", lists ?? note("No open work reported."),
          fm.projects.length > projects.length ? note(`${fm.projects.length - projects.length} more List${fm.projects.length - projects.length === 1 ? "" : "s"} with open work`) : null,
          flags.length ? dlist(flags.map((f) => ({ title: f.title, detail: `${clockOf(f.at)}${f.candidate ? " · rule-based, confirm in ClickUp" : ""}`, tag: f.candidate ? "REVIEW" : f.severity, tone: f.candidate ? "info" : toneFor(f.severity === "HIGH" ? "ATTENTION" : "INFO") }))) : null),
      ],
    };
  },

  priority(fm) {
    const mine = VISIBLE.has(fm.state) && fm.state !== "STALE" ? fm.upcoming.filter((t) => t.overdue && t.mine) : [];
    const first = mine[0];
    return first ? { rank: 30, kicker: "FM OPERATIONS / OVERDUE", title: first.title,
      summary: `${mine.length} task${mine.length === 1 ? "" : "s"} assigned to you overdue${first.project ? ` · ${first.project}` : ""} · ${dueText(first)}`, posture: "OVERDUE", tone: "bad" } : null;
  },

  demo(now) {
    const day = (offset: number) => new Date(now + offset * 86_400_000).toISOString().slice(0, 10);
    const at = (min: number) => new Date(now - min * 60_000).toISOString();
    return {
      clickup: {
        schema_version: "AP3X-CLICKUP-WALL-1", generated_at: at(1), state: "ok",
        counts: { open: 23, overdue: 2, due_soon: 5, high_priority: 3, flags_24h: 3, mentions_7d: 1 },
        upcoming: [
          { title: "Demo: glue viola top plate", project: "VIOLA", status: "to do", due_date: day(-10), overdue: true, mine: true, assignees: ["AB"] },
          { title: "Demo: order harp strings", project: "HARP", status: "to do", due_date: day(0), due_time: "09:00", overdue: true },
          { title: "Demo: synth panel layout review", project: "SYNTH", status: "waiting on parts", due_date: day(1) },
        ],
        projects: [{ name: "VIOLA", open: 9, overdue: 1, tasks: [] }, { name: "HARP", open: 7, overdue: 1, tasks: [] }, { name: "SYNTH", open: 7, overdue: 0, tasks: [] }],
        mentions: [{ author: "Project member", text: "Demo: can you check the bracket tolerances before Friday?", at: at(90), source: "CHAT", task: "Bracket v3" }],
        recent: [{ author: "Project member", text: "Demo: parts arrived for the synth panel.", at: at(30), source: "COMMENT" }],
        flags: [{ title: "Demo: deadline moved earlier", severity: "high", at: at(120) }],
      },
    };
  },
};
