import { el, setTone, toneVar } from "./dom";
import type { Tone } from "./types";

/* Building blocks for module detail views. They match the original Command 57 detail styling. */

export function sec(title: string | null, ...children: (HTMLElement | null | undefined | false)[]): HTMLElement {
  const node = el("section", "dsec");
  if (title) node.append(el("h4", "", title));
  node.append(...children.filter((c): c is HTMLElement => Boolean(c)));
  return node;
}

export const note = (value: string): HTMLElement => el("p", "note", value);

export type Stat = [label: string, value: string | number | null, tone?: Tone | null, small?: string | null];

export function stats(items: Stat[], columns = items.length): HTMLElement {
  const grid = el("div", "dstats");
  grid.style.setProperty("--n", String(columns));
  grid.append(...items.map(([label, value, tone, small]) => {
    const stat = el("div", "dstat");
    if (tone) setTone(stat, tone);
    stat.append(el("span", "", label), el("b", "", value === null || value === "" ? "—" : String(value)));
    if (small) stat.append(el("small", "", small));
    return stat;
  }));
  return grid;
}

export interface ListItem { title: string; detail?: string | null; tag?: string | null; tone?: Tone | null }

export function dlist(items: ListItem[]): HTMLElement {
  const list = el("ol", "dlist");
  list.append(...items.map(({ title, detail, tag, tone }) => {
    const li = el("li");
    li.style.setProperty("--tone", toneVar(tone));
    const copy = el("div");
    copy.append(el("b", "", title));
    if (detail) copy.append(el("small", "", detail));
    li.append(copy, el("em", "", tag ?? ""));
    return li;
  }));
  return list;
}

/** Places a section in the detail grid. */
export function place(node: HTMLElement, column?: string, row?: string): HTMLElement {
  if (column) node.style.gridColumn = column;
  if (row) node.style.gridRow = row;
  return node;
}

/** A paged list with ▲ ▼ buttons (wallpaper hosts often swallow scroll-wheel input). */
export function paged<T>(state: Record<string, unknown>, key: string, items: T[], perPage: number,
                         render: (item: T) => HTMLElement, rebuild: () => void): HTMLElement[] {
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const current = Math.min(Number(state[key] ?? 0), pages - 1);
  state[key] = current;
  const start = current * perPage;
  const list = el("ol", "mlist");
  list.append(...items.slice(start, start + perPage).map(render));
  if (pages === 1) return [list];
  const pager = el("div", "pager");
  const step = (delta: number) => () => { state[key] = (current + delta + pages) % pages; rebuild(); };
  const up = el("button", "btn", "▲"); up.type = "button"; up.title = "Previous page"; up.addEventListener("click", (e) => { e.stopPropagation(); step(-1)(); });
  const down = el("button", "btn", "▼"); down.type = "button"; down.title = "Next page"; down.addEventListener("click", (e) => { e.stopPropagation(); step(1)(); });
  pager.append(up, el("span", "", `${start + 1}–${Math.min(items.length, start + perPage)} OF ${items.length}`), down);
  return [list, pager];
}
