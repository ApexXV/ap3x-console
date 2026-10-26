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

/** A table cell: plain text, [text, tone] for a colored value, or any element (a bar, a dot label). */
export type Cell = string | number | null | [string | number | null, Tone] | HTMLElement;

/** A compact table; `numeric` column indexes are right-aligned. Values can be blurred with `privateColumns`. */
export function table(headers: string[], body: Cell[][], numeric: number[] = [], privateColumns: number[] = []): HTMLElement {
  const node = el("table", "dtable");
  const head = el("tr");
  headers.forEach((h, i) => head.append(el("th", numeric.includes(i) ? "num" : "", h)));
  node.append(el("thead"));
  node.tHead!.append(head);
  const tbody = el("tbody");
  for (const row of body) {
    const tr = el("tr");
    row.forEach((cell, i) => {
      const td = el("td", numeric.includes(i) ? "num" : "");
      if (cell instanceof HTMLElement) td.append(cell);
      else if (Array.isArray(cell)) { td.textContent = cell[0] === null ? "—" : String(cell[0]); td.style.color = toneVar(cell[1]); }
      else td.textContent = cell === null ? "—" : String(cell);
      if (privateColumns.includes(i)) td.dataset.private = "";
      tr.append(td);
    });
    tbody.append(tr);
  }
  node.append(tbody);
  return node;
}

/** A link styled as a button that opens another wall page (e.g. Business Control). */
export function linkButton(label: string, href: string): HTMLElement {
  const a = el("a", "btn link-btn", label);
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener";
  a.addEventListener("click", (event) => event.stopPropagation());
  return a;
}
