import { sec } from "../../core/detail";
import { el, replaceKeepingScroll, tag } from "../../core/dom";
import { clockOf, dayOf } from "../../core/format";
import type { ModuleManifest } from "../../core/types";
import { parseReport, REPORT_MAX_AGE, type Issue, type Report } from "./parse";
import "./report.css";

const when = (stamp: string) => `${dayOf(stamp)} · ${clockOf(stamp)} ET`;
const words = (name: string) => name.replace(/[_-]/g, " ");
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

export function reportSummary(report: Report): string {
  if (report.overdue) return "Report overdue";
  if (report.retained) return "Last report";
  const active = report.issues.filter(i => i.status === "active").length;
  if (active) return count(active, "active issue");
  if (report.sources.some(s => s.status !== "ok")) return "Partial coverage";
  return "No active issues";
}

function pane(title: string): HTMLElement {
  const node = el("div", "rack-scroll");
  node.dataset.preserveScroll = title;
  node.setAttribute("aria-label", title);
  node.setAttribute("role", "region");
  node.tabIndex = 0;
  return node;
}

function issueCard(issue: Issue): HTMLElement {
  const card = el("article", "rack-issue");
  const head = el("div", "rack-heading");
  const uncertain = issue.status === "unconfirmed";
  const status = uncertain ? "Unconfirmed" : { new: "New", changed: "Changed", ongoing: "Ongoing" }[issue.change];
  head.append(el("h3", "", issue.title), tag(status, uncertain ? "muted" : issue.change === "ongoing" ? "info" : "warn"));
  card.append(head);
  if (uncertain) card.append(el("p", "rack-muted", "Last observed evidence. Current source coverage cannot confirm this issue."));
  const facts = el("dl", "rack-facts");
  const origin = el("div");
  origin.append(el("dt", "", "source"), el("dd", "", words(issue.id.split(".")[0]!)));
  facts.append(origin);
  for (const [name, value] of Object.entries(issue.evidence)) {
    const pair = el("div");
    pair.append(el("dt", "", words(name)), el("dd", "", String(value)));
    facts.append(pair);
  }
  card.append(facts);
  if (issue.explanation) {
    const ai = issue.explanation;
    card.append(el("p", "rack-attribution", `${ai.model} · ${when(ai.generated_at)}`), el("p", "", ai.summary));
    const followUp = el("p", "rack-follow-up");
    followUp.append(el("strong", "", "Manual follow-up · "), document.createTextNode(ai.next_step));
    card.append(followUp);
  } else if (!uncertain) {
    card.append(el("p", "rack-muted", "Awaiting an explanation for this evidence."));
  }
  return card;
}

function body(report: Report): HTMLElement {
  const wrap = el("div", "rack-report");
  const header = el("div", "rack-byline");
  const names = [`Checked ${when(report.observedAt)}`, "Every 15 minutes", "Manual repairs"];
  header.append(el("p", "", names.join(" · ")));
  if (report.overdue || report.retained) header.append(tag(report.overdue ? "Report overdue" : "Last received report", "warn"));
  const grid = el("div", "rack-columns");
  const incidents = pane("Rack Steward issues");
  const active = report.issues.filter(i => i.status === "active");
  const uncertain = report.issues.filter(i => i.status === "unconfirmed");
  incidents.append(el("h4", "", `Active issues · ${active.length}`));
  if (!active.length) incidents.append(el("p", "rack-muted",
    report.sources.every(s => s.status === "ok") ? "The checks found no active issues." : "No issues confirmed by the available sources."));
  const order = { new: 0, changed: 1, ongoing: 2 };
  incidents.append(...active.sort((a, b) => order[a.change] - order[b.change]).map(issueCard));
  if (uncertain.length) incidents.append(el("h4", "", `Awaiting fresh evidence · ${uncertain.length}`), ...uncertain.map(issueCard));
  const sources = pane("Rack Steward coverage");
  const checked = report.sources.filter(s => s.status === "ok").length;
  sources.append(el("h4", "", `Source coverage · ${checked}/${report.sources.length}`));
  for (const source of report.sources) {
    const cell = el("div", "rack-source");
    const head = el("div", "rack-heading");
    head.append(el("strong", "", words(source.id)), tag({ ok: "Fresh", stale: "Stale", unavailable: "Unavailable" }[source.status], source.status === "ok" ? "good" : "warn"));
    cell.append(head, el("small", "", source.observed_at ? when(source.observed_at) : "Observation unavailable"));
    sources.append(cell);
  }
  if (report.analysis.status !== "current") sources.append(el("h4", "", "Astra analysis"), el("p", "rack-muted",
    `${report.analysis.status === "unavailable" ? "Analysis unavailable" : "Analysis pending"} · ${count(report.analysis.pending, "issue")} awaiting explanation`));
  if (report.recovered.length) {
    sources.append(el("h4", "", "Recovered in the past 24 hours"));
    for (const issue of report.recovered) {
      const item = el("div", "rack-source");
      item.append(el("strong", "", issue.title), el("small", "", when(issue.recovered_at)));
      sources.append(item);
    }
  }
  grid.append(incidents, sources);
  wrap.append(header, grid);
  return wrap;
}

const unavailable = () => el("p", "module-error", "The scheduled RackMain1 report is unavailable.");

export const rackStewardModule: ModuleManifest<Report | null> = {
  id: "rack-steward", title: "Rack Steward", version: "1.0.0",
  description: "Scheduled RackMain1 health observations and evidence-linked Astra explanations.",
  sources: [{ id: "rack-steward", url: "/rack-steward-data/current.json", optional: true,
    stampField: "observed_at", maxAgeMs: REPORT_MAX_AGE }],
  model(ctx) {
    const source = ctx.sources["rack-steward"];
    return ctx.mode === "live" ? parseReport(source?.data, ctx.now, source?.status === "retained") : null;
  },
  chip: m => ({ label: m ? reportSummary(m) : "Unavailable", tone: !m || m.overdue ? "warn" : "info" }),
  render(panel, report) {
    replaceKeepingScroll(panel, report ? body(report) : unavailable());
  },
  detail(report) {
    return { title: "Rack Steward", columns: "minmax(0, 1fr)", rows: "minmax(0, 1fr)",
      sections: [sec(null, report ? body(report) : unavailable())] };
  },
};
