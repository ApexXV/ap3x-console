import { el, tag } from "../../core/dom";
import { clockOf, dayOf, record } from "../../core/format";
import type { ModuleContext, SourceSpec } from "../../core/types";

export const operationsSource: SourceSpec = {
  id: "rack-operations", url: "/rack-steward-data/operations.json", optional: true,
  stampField: "generatedAt", maxAgeMs: 20 * 60_000,
};

interface Operations {
  schemaVersion: 1;
  generatedAt: string;
  status: "ok" | "degraded";
  host: {
    cpuPercent: number | null; memoryPercent: number | null; load1: number | null;
    filesystems: { mount: string; usedPercent: number | null }[];
  };
  containers: { running: number | null; total: number | null; unhealthy: string[]; stopped: string[] };
  recovery: { target: string; status: string; reason: string };
  incidents?: { id: string; title: string; detail: string }[];
  decision?: { action: string; reason: string } | null;
  sms: { status: string; detail?: string };
  events: { at: string; kind: string; message: string }[];
}

const text = (v: unknown, limit: number): v is string =>
  typeof v === "string" && v.trim().length > 0 && v.length <= limit;
const timestamp = (v: unknown): v is string =>
  text(v, 48) && /(?:Z|\+00:00)$/.test(v) && Number.isFinite(Date.parse(v));
const number = (v: unknown): v is number | null =>
  v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0);
const percent = (v: unknown): boolean => number(v) && (v === null || v <= 100);
const count = (v: unknown): boolean => number(v) && (v === null || Number.isSafeInteger(v));
const names = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length <= 512 && v.every(name => text(name, 160));

function valid(v: unknown): v is Operations {
  if (!record(v) || v.schemaVersion !== 1 || !timestamp(v.generatedAt) || !["ok", "degraded"].includes(String(v.status))
      || !record(v.host) || !record(v.containers) || !record(v.recovery) || !record(v.sms)) return false;
  const { host: h, containers: c, recovery: r, sms, decision: d } = v;
  return percent(h.cpuPercent) && percent(h.memoryPercent) && number(h.load1)
    && Array.isArray(h.filesystems) && h.filesystems.length <= 128
    && h.filesystems.every(f => record(f) && text(f.mount, 256) && percent(f.usedPercent))
    && count(c.running) && count(c.total) && names(c.unhealthy) && names(c.stopped)
    && (v.incidents === undefined || (Array.isArray(v.incidents) && v.incidents.length <= 256
      && v.incidents.every(i => record(i) && text(i.id, 160) && text(i.title, 200) && text(i.detail, 600))))
    && text(r.target, 160) && text(r.status, 80) && text(r.reason, 600)
    && (d == null || (record(d) && text(d.action, 80) && text(d.reason, 600)))
    && text(sms.status, 80) && (sms.detail === undefined || text(sms.detail, 600))
    && Array.isArray(v.events) && v.events.length <= 256
    && v.events.every(e => record(e) && timestamp(e.at) && text(e.kind, 80) && text(e.message, 600));
}

type Feed = { sample: Operations; freshness: "current" | "retained" | "stale" } | null;

export function readOperations(ctx: ModuleContext): Feed {
  const source = ctx.sources[operationsSource.id];
  if (ctx.mode !== "live" || !valid(source?.data)) return null;
  const sample = source.data;
  const age = ctx.now - Date.parse(sample.generatedAt);
  if (age < -60_000) return null;
  const freshness = age > operationsSource.maxAgeMs! ? "stale" : source.status === "retained" ? "retained" : "current";
  return { sample, freshness };
}

const displayTime = (t: string) => `${dayOf(t)} · ${clockOf(t)} ET`;
const words = (v: string) => v.replace(/[_-]/g, " ");
const pct = (n: number | null) => n === null ? "Unavailable" : `${Math.round(n)}%`;
function row(label: string, value: string): HTMLElement {
  const line = el("div", "rack-ops-row");
  line.append(el("dt", "", label), el("dd", "", value));
  return line;
}

export function operationsPane(feed: Feed): HTMLElement {
  const pane = el("section", "rack-ops");
  pane.setAttribute("aria-label", "Rack operations");
  const head = el("div", "rack-heading");
  head.append(el("h3", "", "Rack operations"));
  pane.append(head);
  if (!feed) {
    pane.append(el("p", "rack-muted", "The rack operations feed is unavailable."));
    return pane;
  }
  const { sample, freshness } = feed;
  const status = freshness === "stale" ? "Overdue" : freshness === "retained" ? "Last received"
    : sample.status === "degraded" ? "Needs attention" : "Fresh";
  head.append(tag(status, status === "Fresh" ? "good" : "warn"));
  pane.append(el("small", "rack-attribution", `Checked ${displayTime(sample.generatedAt)}`));
  if (sample.incidents?.length) {
    pane.append(el("h4", "", "Needs attention"));
    for (const incident of sample.incidents) {
      const issue = el("article", "rack-source");
      issue.append(el("strong", "", incident.title), el("p", "", incident.detail));
      pane.append(issue);
    }
  }
  const facts = el("dl", "rack-ops-facts");
  const { host, containers, recovery, sms } = sample;
  facts.append(row("CPU", pct(host.cpuPercent)), row("Load · 1 min", host.load1?.toFixed(2) ?? "Unavailable"),
    row("Memory", pct(host.memoryPercent)));
  for (const fs of host.filesystems) facts.append(row(fs.mount, `${pct(fs.usedPercent)}${fs.usedPercent === null ? "" : " used"}`));
  facts.append(row("Containers", containers.running === null || containers.total === null
    ? "Inventory unavailable" : `${containers.running} of ${containers.total} running`));
  if (containers.unhealthy.length) facts.append(row("Unhealthy", containers.unhealthy.join(", ")));
  if (containers.stopped.length) facts.append(row("Stopped", containers.stopped.join(", ")));
  facts.append(row("Recovery", `${recovery.target} · ${words(recovery.status)}`), row("Assessment", recovery.reason));
  if (sample.decision) facts.append(row("Astra decision", `${words(sample.decision.action)} · ${sample.decision.reason}`));
  facts.append(row("SMS updates", words(sms.status)));
  if (sms.detail) facts.append(row("Delivery", sms.detail));
  pane.append(facts);
  if (sample.events.length) {
    pane.append(el("h4", "", "Recent events"));
    const timeline = el("ol", "rack-events");
    for (const event of [...sample.events].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 20)) {
      const item = el("li");
      item.append(el("small", "rack-attribution", `${displayTime(event.at)} · ${words(event.kind)}`), el("p", "", event.message));
      timeline.append(item);
    }
    pane.append(timeline);
  }
  return pane;
}
