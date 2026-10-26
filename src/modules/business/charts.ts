import { el, setTone, svgEl } from "../../core/dom";
import { dueLabel, dueTone, money, signedMoney } from "../../core/format";
import type { AllocationPart, Day, Obligation, Week } from "./model";

/* Charts shared by the business panels and their detail views. Amounts carry data-private so the
 * console's privacy mode blurs them. */

/** Daily money in (up) and out (down) bars with the running net as a line; hover shows the day. */
export function cashflowChart(daily: Day[]): HTMLElement {
  const wrap = el("div", "cashflow");
  const svg = svgEl("svg", { viewBox: "0 0 1000 400", preserveAspectRatio: "none" });
  const axis = el("div", "cashflow-axis");
  wrap.append(svg, axis);
  wrap.dataset.private = "";
  if (!daily.length) {
    wrap.replaceChildren(el("p", "empty", "BANK ACTIVITY UNAVAILABLE"));
    return wrap;
  }
  const W = 1000, H = 400, mid = H * 0.58;
  const maxIn = Math.max(1, ...daily.map((d) => d.moneyIn));
  const maxOut = Math.max(1, ...daily.map((d) => d.moneyOut));
  const slot = W / daily.length;
  const bw = slot * 0.62;
  svg.append(svgEl("line", { class: "zero", x1: 0, x2: W, y1: mid, y2: mid }));
  let running = 0;
  const cumulative = daily.map((d) => (running += d.net));
  const span = Math.max(1, ...cumulative.map(Math.abs));
  daily.forEach((d, i) => {
    const x = i * slot + (slot - bw) / 2;
    const hIn = (d.moneyIn / maxIn) * (mid - 20);
    const hOut = (d.moneyOut / maxOut) * (H - mid - 10);
    if (hIn > 0) svg.append(svgEl("rect", { class: "bar-in", x, y: mid - hIn, width: bw, height: hIn }));
    if (hOut > 0) svg.append(svgEl("rect", { class: "bar-out", x, y: mid, width: bw, height: hOut }));
    const hit = svgEl("rect", { class: "hit", x: i * slot, y: 0, width: slot, height: H });
    const title = svgEl("title");
    title.textContent = `${d.date}\nIN ${money(d.moneyIn)} · OUT ${money(d.moneyOut)}\nRUNNING NET ${signedMoney(cumulative[i] ?? 0)}`;
    hit.append(title);
    svg.append(hit);
  });
  const points = cumulative.map((v, i) => `${(i + 0.5) * slot},${mid - (v / span) * (mid - 30)}`).join(" ");
  svg.insertBefore(svgEl("polyline", { class: "net-line", points }), svg.querySelector(".hit"));
  for (const index of [...new Set([0, 7, 14, 21, daily.length - 1])]) {
    const d = daily[index];
    if (d) axis.append(el("span", "", d.date.slice(5).replace("-", "/")));
  }
  return wrap;
}

/** The last few weeks' net as small bars; the newest is "this week". */
export function weekBars(weeks: Week[]): HTMLElement {
  const host = el("div", "weeks");
  host.style.setProperty("--n", String(Math.max(1, weeks.length)));
  const max = Math.max(1, ...weeks.map((w) => Math.abs(w.net)));
  host.append(...weeks.map((w, i) => {
    const node = el("div", i === weeks.length - 1 ? "week is-current" : "week");
    node.style.setProperty("--h", `${(Math.abs(w.net) / max) * 100}%`);
    setTone(node, w.net < 0 ? "bad" : "good");
    const value = el("b", "", signedMoney(w.net, 0));
    value.dataset.private = "";
    node.append(el("i"), el("span", "", i === weeks.length - 1 ? "THIS WEEK" : `WK ${w.start.slice(5).replace("-", "/")}`), value);
    return node;
  }));
  return host;
}

/** A -7 … +60 day track with a mark per dated obligation. */
export function obligationTimeline(obligations: Obligation[]): HTMLElement {
  const lo = -7, hi = 60;
  const pos = (days: number) => `${((Math.max(lo, Math.min(hi, days)) - lo) / (hi - lo)) * 100}%`;
  const timeline = el("div", "timeline");
  const ticks = el("div", "timeline-ticks");
  ticks.append(...[-7, 0, 7, 14, 30, 45, 60].map((d) => {
    const tick = el("span", "", d === 0 ? "" : d < 0 ? `${d}D` : `+${d}D`);
    tick.style.left = pos(d);
    return tick;
  }));
  const marks = el("div", "timeline-marks");
  const now = el("span", "mark-now");
  now.style.left = pos(0);
  marks.append(now, ...obligations.filter((o) => o.days !== null && o.days <= hi).map((o) => {
    const mark = el("span", "mark");
    mark.style.left = pos(o.days!);
    setTone(mark, dueTone(o.days));
    mark.title = `${o.title} · ${dueLabel(o.days)}`;
    return mark;
  }));
  timeline.append(el("div", "timeline-track"), ticks, marks);
  return timeline;
}

/** A ring split into parts by value. */
export function donut(parts: AllocationPart[], radius = 78): SVGSVGElement {
  const svg = svgEl("svg", { viewBox: "0 0 200 200", class: "donut" });
  svg.append(svgEl("circle", { class: "donut-bg", cx: 100, cy: 100, r: radius }));
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  let offset = 0;
  for (const part of parts) {
    const length = (part.value / total) * 100;
    if (length > 0) {
      svg.append(svgEl("circle", { cx: 100, cy: 100, r: radius, pathLength: 100, stroke: part.color,
        "stroke-dasharray": `${Math.max(0, length - 0.6)} ${100 - length + 0.6}`, "stroke-dashoffset": -offset }));
    }
    offset += length;
  }
  return svg;
}
