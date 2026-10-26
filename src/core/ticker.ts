import { el } from "./dom";
import { TZ } from "./format";
import type { TickerItem } from "./types";

/* The bottom ticker: a "LIVE" label, a scrolling track of items (duplicated so the loop is
 * seamless), and a meta line. Today / tonight items lead; the rest follow by order. */

export function tickerElement(): HTMLElement {
  const footer = el("footer", "ticker");
  footer.setAttribute("aria-label", "Live ticker");
  const label = el("span", "ticker-label", "LIVE");
  const windowNode = el("div", "ticker-window");
  windowNode.append(el("div", "ticker-track"));
  footer.append(label, windowNode, el("span", "ticker-meta", ""));
  return footer;
}

export function sortTicker(items: TickerItem[]): TickerItem[] {
  return items.map((item, index) => ({ item, index }))
    .sort((a, b) => Number(Boolean(b.item.hot)) - Number(Boolean(a.item.hot)) || (a.item.order ?? 100) - (b.item.order ?? 100) || a.index - b.index)
    .map(({ item }) => item);
}

let lastKey = "";

export function renderTicker(footer: HTMLElement, items: TickerItem[], meta: string): void {
  const sorted = sortTicker(items);
  const list = sorted.length ? sorted : [{ label: "AP3X", value: "Waiting for console sources" }];
  footer.querySelector(".ticker-meta")!.textContent = meta;
  const key = JSON.stringify(list);
  if (key === lastKey) return; // keep the scroll position when nothing changed
  lastKey = key;
  const make = () => list.map((item) => {
    const span = el("span", item.hot ? "is-tonight" : "");
    const value = el("span", "", item.value);
    if (item.private) value.dataset.private = "";
    span.append(el("b", "", item.label), value);
    return span;
  });
  const track = footer.querySelector<HTMLElement>(".ticker-track")!;
  track.replaceChildren(...make(), ...make());
  track.style.setProperty("--ticker", `${Math.max(60, list.length * 9)}s`);
}

/** "TONIGHT" from 17:00 Eastern, "TODAY" before. */
export function tonightLabel(now: number): "TODAY" | "TONIGHT" {
  return eastHour(now) >= 17 ? "TONIGHT" : "TODAY";
}

export const eastHour = (now: number): number =>
  Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(now));
