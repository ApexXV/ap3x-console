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
