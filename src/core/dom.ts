import type { Tone } from "./types";

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", content?: string | number | null): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined && content !== null) node.textContent = String(content);
  return node;
}

export const toneVar = (tone: Tone | null | undefined): string =>
  `var(--${({ good: "good", warn: "warn", bad: "bad", info: "ap3x-cyan", muted: "dim" } as const)[tone ?? "info"]})`;

export function setTone(node: HTMLElement, tone: Tone | null | undefined): void {
  node.style.setProperty("--tone", toneVar(tone));
}

export function chipNode(label: string, tone: Tone): HTMLElement {
  const chip = el("span", "chip", label);
  chip.dataset.tone = tone;
  return chip;
}

/** A horizontal bar, 0..1. */
export function bar(fraction: number | null | undefined, tone: Tone = "info"): HTMLElement {
  const node = el("span", "dbar");
  node.style.setProperty("--w", `${Math.max(0, Math.min(1, fraction ?? 0)) * 100}%`);
  setTone(node, tone);
  return node;
}

export function tag(label: string, tone: Tone): HTMLElement {
  const node = el("em", "mtag", label);
  setTone(node, tone);
  return node;
}

export function button(label: string, title: string, onClick: () => void, className = "btn"): HTMLButtonElement {
  const node = el("button", className, label);
  node.type = "button";
  node.title = title;
  node.addEventListener("click", (event) => { event.stopPropagation(); onClick(); });
  return node;
}

/** Marks a node for blurring in privacy mode (names, amounts). */
export function privateText(node: HTMLElement): HTMLElement {
  node.dataset.private = "";
  return node;
}

/** An SVG line chart of one or more series sharing a y scale (0..max), newest on the right. */
export function sparkline(series: { values: number[]; tone: Tone; fill?: boolean }[], label: string): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "spark");
  svg.setAttribute("viewBox", "0 0 100 40");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", label);
  const length = Math.max(2, ...series.map((s) => s.values.length));
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  for (const s of series) {
    if (s.values.length < 2) continue;
    const offset = length - s.values.length;
    const points = s.values.map((v, i) => `${(((i + offset) / (length - 1)) * 100).toFixed(2)},${(38 - (Math.max(0, v) / max) * 36).toFixed(2)}`);
    if (s.fill) {
      const area = document.createElementNS(ns, "polygon");
      area.setAttribute("points", `${points[0]!.split(",")[0]},40 ${points.join(" ")} 100,40`);
      area.setAttribute("style", `fill: ${toneVar(s.tone)}; opacity: .14`);
      svg.append(area);
    }
    const line = document.createElementNS(ns, "polyline");
    line.setAttribute("points", points.join(" "));
    line.setAttribute("vector-effect", "non-scaling-stroke");
    line.setAttribute("style", `fill: none; stroke: ${toneVar(s.tone)}; stroke-width: 2`);
    svg.append(line);
  }
  return svg;
}

/** A labelled figure for panel bodies: small caps label, large value, optional footnote. */
export function tile(label: string, value: string | number | null, tone?: Tone | null, small?: string | null): HTMLElement {
  const node = el("div", "tile");
  if (tone) setTone(node, tone);
  node.append(el("span", "", label), el("b", "", value === null || value === "" ? "—" : String(value)));
  if (small) node.append(el("small", "", small));
  return node;
}

/** A row of tiles laid out in `columns` equal columns. */
export function tileRow(tiles: HTMLElement[], columns = tiles.length): HTMLElement {
  const row = el("div", "tile-row");
  row.style.setProperty("--n", String(columns));
  row.append(...tiles);
  return row;
}
