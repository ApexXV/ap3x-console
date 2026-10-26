import { el } from "./dom";
import { validateLayout } from "./layout";
import { getModule, moduleIds } from "./registry";
import type { Layout, LayoutPanel } from "./types";

/* The layout editor: rearrange a layout on the screen it runs on, and keep the result in this
 * browser. Column widths follow the dock (each focus preset keeps its own widths), lines inside a
 * region resize its grid tracks, panels swap places (each spot keeps its size, the contents move),
 * a corner drag changes how many cells a panel spans, and panels can be added or removed. */

const SAVE_VERSION = 1;
const MIN_TRACK = 0.06; // a track never shrinks below 6% of its grid

/* ---------------- saved layouts (per layout id, in this browser) ---------------- */

export const savedKey = (id: string): string => `console-layout-${id}`;

/** A short fingerprint of the built-in layout, so an edit can tell when a release changed it. */
export function layoutHash(layout: Layout): string {
  let h = 5381;
  for (const ch of JSON.stringify(layout)) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

export interface Saved { layout: Layout; baseChanged: boolean }

/** The edited layout saved for `base`, if there is one and it is still valid. */
export function loadSaved(base: Layout, storage: Storage | null, known: (id: string) => boolean): Saved | null {
  try {
    const raw = JSON.parse(storage?.getItem(savedKey(base.id)) ?? "null") as { v?: number; base?: string; layout?: Layout } | null;
    if (!raw || raw.v !== SAVE_VERSION || !raw.layout || raw.layout.id !== base.id) return null;
    if (validateLayout(raw.layout, known).length) return null;
    if (!sameRegions(raw.layout, base)) return null; // regions are fixed; a release that changed them wins
    return { layout: raw.layout, baseChanged: raw.base !== layoutHash(base) };
  } catch { return null; }
}

export function saveLayout(layout: Layout, base: Layout, storage: Storage | null): void {
  try { storage?.setItem(savedKey(base.id), JSON.stringify({ v: SAVE_VERSION, base: layoutHash(base), layout })); } catch { /* optional */ }
}

export function clearSaved(base: Layout, storage: Storage | null): void {
  try { storage?.removeItem(savedKey(base.id)); } catch { /* optional */ }
}

const sameRegions = (a: Layout, b: Layout): boolean =>
  a.regions.map((r) => r.id).join() === b.regions.map((r) => r.id).join();

/* ---------------- edits (pure: each returns a new layout) ---------------- */

const clone = (layout: Layout): Layout => structuredClone(layout);

/** "minmax(0, 5.2fr) minmax(0, 8fr)" from relative sizes (any unit; normalised to sum to `total`). */
export function formatTracks(sizes: number[], total = sizes.length): string {
  const sum = sizes.reduce((s, v) => s + v, 0) || 1;
  return sizes.map((v) => `minmax(0, ${Number(((v / sum) * total).toFixed(2))}fr)`).join(" ");
}

/** Move the boundary after track `index` by `delta` (same unit as `sizes`), keeping both sides above the minimum. */
export function moveBoundary(sizes: number[], index: number, delta: number): number[] {
  const total = sizes.reduce((s, v) => s + v, 0);
  const min = total * MIN_TRACK;
  const a = sizes[index]!, b = sizes[index + 1]!;
  const d = Math.max(min - a, Math.min(b - min, delta));
  const next = sizes.slice();
  next[index] = a + d;
  next[index + 1] = b - d;
  return next;
}

/** How many tracks a placement spans: "span 2" → 2, "1 / span 4" → 4, "1 / -1" → all, none → 1. */
export function spanOf(placement: string | undefined, count: number): number {
  if (!placement) return 1;
  const span = /span\s+(\d+)/.exec(placement);
  if (span) return Number(span[1]);
  const pair = /^\s*(-?\d+)\s*\/\s*(-?\d+)\s*$/.exec(placement);
  if (pair) {
    const resolve = (v: number) => (v < 0 ? count + 2 + v : v);
    return Math.max(1, resolve(Number(pair[2])) - resolve(Number(pair[1])));
  }
  return 1;
}

/** The placement with a new span, keeping an explicit start line ("2 / span 3") when there is one. */
export function withSpan(placement: string | undefined, span: number): string | undefined {
  const start = placement && /^\s*(-?\d+)\s*\//.exec(placement)?.[1];
  if (start) return `${start} / span ${span}`;
  return span > 1 ? `span ${span}` : undefined;
}

function findPanel(layout: Layout, id: string): { list: LayoutPanel[]; index: number } | null {
  for (const region of layout.regions) {
    const index = region.panels.findIndex((p) => p.id === id);
    if (index >= 0) return { list: region.panels, index };
  }
  return null;
}

/** Swap two panels' contents; each spot keeps its size and position (column / row stay put). */
export function swapPanels(layout: Layout, a: string, b: string): Layout {
  const next = clone(layout);
  const pa = findPanel(next, a), pb = findPanel(next, b);
  if (!pa || !pb || a === b) return next;
  const A = pa.list[pa.index]!, B = pb.list[pb.index]!;
  const place = (p: LayoutPanel) => ({ column: p.column, row: p.row });
  const [ga, gb] = [place(A), place(B)];
  pa.list[pa.index] = { ...B, ...ga };
  pb.list[pb.index] = { ...A, ...gb };
  for (const p of [pa.list[pa.index]!, pb.list[pb.index]!]) {
    if (p.column === undefined) delete p.column;
    if (p.row === undefined) delete p.row;
  }
  // A region head that summarised one of the swapped panels now names whatever took its spot.
  for (const region of next.regions) if (region.chipFrom) region.chipFrom = region.chipFrom.map((id) => (id === a ? b : id === b ? a : id));
  return next;
}

export function resizePanel(layout: Layout, id: string, columns: number, rows: number): Layout {
  const next = clone(layout);
  const found = findPanel(next, id);
  if (!found) return next;
  const panel = found.list[found.index]!;
  const column = withSpan(panel.column, columns), row = withSpan(panel.row, rows);
  if (column) panel.column = column; else delete panel.column;
  if (row) panel.row = row; else delete panel.row;
  return next;
}

export function removePanel(layout: Layout, id: string): Layout {
  const next = clone(layout);
  const found = findPanel(next, id);
  if (found) found.list.splice(found.index, 1);
  for (const region of next.regions) if (region.chipFrom) region.chipFrom = region.chipFrom.filter((p) => p !== id);
  return next;
}

export function addPanel(layout: Layout, regionId: string, moduleId: string): Layout {
  const next = clone(layout);
  const region = next.regions.find((r) => r.id === regionId);
  if (!region) return next;
  const taken = new Set(next.regions.flatMap((r) => r.panels.map((p) => p.id)));
  const stem = moduleId.slice(0, 36);
  let n = 1;
  while (taken.has(n === 1 ? stem : `${stem}-${n}`)) n += 1;
  region.panels.push({ id: n === 1 ? stem : `${stem}-${n}`, module: moduleId });
  return next;
}

/** Column widths for the current focus preset ("balanced" = regionColumns). */
export function setRegionWidths(layout: Layout, focus: string, columns: string): Layout {
  const next = clone(layout);
  if (focus === "balanced" || !next.focus?.[focus]) next.regionColumns = columns;
  else next.focus[focus] = columns;
  return next;
}

export function setRegionTracks(layout: Layout, regionId: string, axis: "columns" | "rows", template: string): Layout {
  const next = clone(layout);
  const region = next.regions.find((r) => r.id === regionId);
  if (region) region[axis] = template;
  return next;
}

/* ---------------- the editor UI ---------------- */

export interface EditorHost {
  readonly layout: Layout;
  readonly base: Layout;
  root: HTMLElement;
  stage: HTMLElement;
  storage: Storage | null;
  /** Current focus preset ("balanced" or a region id). */
  focus(): string;
  relayout(layout: Layout): void;
}

type Drag = { move(dx: number, dy: number, event: PointerEvent): void; end(commit: boolean, event: PointerEvent): void };

const px = (value: string): number[] => value.split(/\s+/).map((v) => Number.parseFloat(v)).filter((v) => Number.isFinite(v));

export class LayoutEditor {
  private active = false;
  private undoStack: string[] = [];
  private bar: HTMLElement | null = null;
  private note!: HTMLElement;
  private undoButton!: HTMLButtonElement;
  private resetArmed = 0;
  private picker: HTMLElement | null = null;
  private observers: ResizeObserver[] = [];

  constructor(private host: EditorHost, private baseChanged = false) {
    host.stage.addEventListener("console-relayout", () => { if (this.active) this.decorate(); });
    document.addEventListener("keydown", (event) => this.key(event));
  }

  get editing(): boolean {
    return this.active;
  }

  /** The pencil button for the top bar, next to night and privacy. */
  toggleButton(): HTMLButtonElement {
    const b = el("button", "icon-toggle edit-toggle");
    b.type = "button";
    b.title = "Edit layout (E)";
    b.setAttribute("aria-pressed", "false");
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>';
    b.addEventListener("click", (event) => { event.stopPropagation(); this.toggle(); });
    return b;
  }

  toggle(on = !this.active): void {
    this.active = on;
    this.host.root.dataset.editing = on ? "on" : "off";
    this.host.root.querySelectorAll(".edit-toggle").forEach((b) => b.setAttribute("aria-pressed", String(on)));
    if (on) {
      this.bar ??= this.buildBar();
      this.host.stage.append(this.bar);
      this.decorate();
      this.status();
    } else {
      this.bar?.remove();
      this.closePicker();
      this.clearDecorations();
    }
  }

  /* ---------------- commits ---------------- */

  private commit(next: Layout, message?: string): void {
    const problems = validateLayout(next, (id) => Boolean(getModule(id)));
    if (problems.length) { this.flash(`Not applied: ${problems[0]}`); this.decorate(); return; }
    this.undoStack.push(JSON.stringify(this.host.layout));
    if (this.undoStack.length > 50) this.undoStack.shift();
    saveLayout(next, this.host.base, this.host.storage);
    this.host.relayout(next);
    this.status(message);
  }

  private undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    const layout = JSON.parse(previous) as Layout;
    saveLayout(layout, this.host.base, this.host.storage);
    this.host.relayout(layout);
    this.status("Undone");
  }

  private reset(): void {
    if (Date.now() - this.resetArmed > 4000) {
      this.resetArmed = Date.now();
      this.flash("Press RESET again to go back to the built-in layout (UNDO still works after).");
      return;
    }
    this.resetArmed = 0;
    this.undoStack.push(JSON.stringify(this.host.layout));
    clearSaved(this.host.base, this.host.storage);
    this.baseChanged = false;
    this.host.relayout(structuredClone(this.host.base));
    this.status("Back to the built-in layout");
  }

  private exportLayout(): void {
    const blob = new Blob([`${JSON.stringify(this.host.layout, null, 2)}\n`], { type: "application/json" });
    const a = el("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${this.host.layout.id}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    this.flash(`Saved ${this.host.layout.id}.json. Send it over to make it the built-in layout, or IMPORT it on another screen.`);
  }

  private importLayout(file: File): void {
    void file.text().then((text) => {
      let layout: Layout;
      try { layout = JSON.parse(text) as Layout; } catch { this.flash("That file is not JSON."); return; }
      if (layout?.id !== this.host.base.id) { this.flash(`That file is for "${layout?.id ?? "?"}", not ${this.host.base.id}.`); return; }
      if (!sameRegions(layout, this.host.base)) { this.flash("That file has different regions than this layout."); return; }
      this.commit(layout, "Imported");
    });
  }

  /* ---------------- toolbar ---------------- */

  private buildBar(): HTMLElement {
    const bar = el("div", "edit-bar");
    const button = (label: string, title: string, run: () => void) => {
      const b = el("button", "", label);
      b.type = "button";
      b.title = title;
      b.addEventListener("click", (event) => { event.stopPropagation(); run(); });
      return b;
    };
    const file = el("input");
    file.type = "file";
    file.accept = "application/json,.json";
    file.hidden = true;
    file.addEventListener("change", () => { if (file.files?.[0]) this.importLayout(file.files[0]); file.value = ""; });
    this.note = el("span", "edit-note");
    this.undoButton = button("UNDO", "Undo the last change (Ctrl+Z)", () => this.undo());
    bar.append(el("b", "", "EDITING LAYOUT"), this.note, this.undoButton,
      button("RESET", "Go back to the built-in layout", () => this.reset()),
      button("EXPORT", "Download this layout as a JSON file", () => this.exportLayout()),
      button("IMPORT", "Load a layout file exported earlier", () => file.click()),
      button("DONE", "Leave the editor (E or Esc)", () => this.toggle(false)), file);
    return bar;
  }

  private status(message?: string): void {
    if (!this.bar) return;
    const focus = this.host.focus();
    const widths = this.host.layout.navigation === "columns" || !this.host.layout.navigation
      ? `Column widths: ${focus === "balanced" ? "BALANCED" : `${focus.toUpperCase()} focus`}`
      : "";
    const parts = [message, widths, "Drag ⠿ onto a panel to swap · drag a corner to resize · drag the lines to size columns and rows",
      this.baseChanged ? "The built-in layout changed since these edits; RESET to get it" : null].filter(Boolean);
    this.note.textContent = parts.join(" · ");
    this.undoButton.disabled = !this.undoStack.length;
  }

  private flashTimer: ReturnType<typeof setTimeout> | undefined;
  private flash(text: string): void {
    if (!this.bar) return;
    this.note.textContent = text;
    this.note.classList.add("is-flash");
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => { this.note.classList.remove("is-flash"); this.status(); }, 5000);
  }

  /* ---------------- decorations: handles on panels, lines on grids ---------------- */

  private clearDecorations(): void {
    for (const o of this.observers) o.disconnect();
    this.observers = [];
    this.host.stage.querySelectorAll(".edit-tools, .track-handle, .edit-add").forEach((n) => n.remove());
  }

  private decorate(): void {
    this.clearDecorations();
    const { layout, stage } = this.host;
    for (const region of layout.regions) {
      const section = stage.querySelector<HTMLElement>(`.region[data-region="${region.id}"]`);
      if (!section) continue;
      const head = section.querySelector(".region-head");
      const add = el("button", "edit-add", "+ PANEL");
      add.type = "button";
      add.title = `Add a panel to ${region.title.toLowerCase()}`;
      add.addEventListener("click", (event) => { event.stopPropagation(); this.openPicker(region.id, add); });
      (head ?? section).append(add);
      const grid = section.querySelector<HTMLElement>(".region-grid")!;
      this.trackHandles(grid, "columns", (sizes) => this.commit(setRegionTracks(this.host.layout, region.id, "columns", formatTracks(sizes, sizes.length))));
      this.trackHandles(grid, "rows", (sizes) => this.commit(setRegionTracks(this.host.layout, region.id, "rows", formatTracks(sizes, sizes.length))));
      for (const panel of region.panels) {
        const article = section.querySelector<HTMLElement>(`#panel-${panel.id}`);
        if (article) this.panelTools(article, panel, grid);
      }
    }
    const regions = stage.querySelector<HTMLElement>(".regions");
    if (regions && (layout.navigation ?? "columns") === "columns" && layout.regions.length > 1) {
      this.trackHandles(regions, "columns", (sizes) => {
        const focus = this.host.focus();
        this.commit(setRegionWidths(this.host.layout, focus, formatTracks(sizes, sizes.length)), `${focus === "balanced" ? "Balanced" : `${focus.toUpperCase()} focus`} widths saved`);
      });
    }
  }

  private scale(): number {
    return this.host.stage.getBoundingClientRect().width / this.host.layout.stage.width || 1;
  }

  /** Lines between the tracks of a grid; dragging one moves that boundary. */
  private trackHandles(grid: HTMLElement, axis: "columns" | "rows", done: (sizes: number[]) => void): void {
    const handles: HTMLElement[] = [];
    const place = () => {
      const style = getComputedStyle(grid);
      const sizes = px(axis === "columns" ? style.gridTemplateColumns : style.gridTemplateRows);
      const gap = Number.parseFloat(axis === "columns" ? style.columnGap : style.rowGap) || 0;
      if (!grid.clientWidth || sizes.length < 2) { handles.forEach((h) => { h.hidden = true; }); return; }
      while (handles.length < sizes.length - 1) {
        const handle = el("div", `track-handle is-${axis}`);
        handle.dataset.index = String(handles.length);
        handle.addEventListener("pointerdown", (event) => this.dragTrack(event, grid, axis, Number(handle.dataset.index), done));
        grid.append(handle);
        handles.push(handle);
      }
      let at = 0;
      sizes.slice(0, -1).forEach((size, i) => {
        at += size + (i ? gap : 0);
        const h = handles[i]!;
        h.hidden = false;
        h.style[axis === "columns" ? "left" : "top"] = `${at + gap / 2}px`;
      });
    };
    place();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(place);
      observer.observe(grid);
      this.observers.push(observer);
    }
  }

  private dragTrack(event: PointerEvent, grid: HTMLElement, axis: "columns" | "rows", index: number, done: (sizes: number[]) => void): void {
    const style = getComputedStyle(grid);
    const start = px(axis === "columns" ? style.gridTemplateColumns : style.gridTemplateRows);
    const prop = axis === "columns" ? "gridTemplateColumns" : "gridTemplateRows";
    const before = grid.style[prop];
    let sizes = start;
    this.drag(event, {
      move: (dx, dy) => {
        sizes = moveBoundary(start, index, axis === "columns" ? dx : dy);
        grid.style[prop] = sizes.map((s) => `${s}px`).join(" ");
      },
      end: (commit) => {
        grid.style[prop] = before;
        if (commit && sizes !== start) done(sizes);
      },
    });
  }

  private panelTools(article: HTMLElement, panel: LayoutPanel, grid: HTMLElement): void {
    const tools = el("div", "edit-tools");
    const grip = el("button", "edit-grip", "⠿ MOVE");
    grip.type = "button";
    grip.title = "Drag onto another panel to swap them";
    const remove = el("button", "edit-remove", "×");
    remove.type = "button";
    remove.title = `Remove ${panel.title ?? getModule(panel.module)?.title ?? panel.id}`;
    const corner = el("div", "edit-corner");
    corner.title = "Drag to resize";
    const size = el("span", "edit-size");
    tools.append(grip, remove, corner, size);
    article.append(tools);
    const style = getComputedStyle(grid);
    const columns = px(style.gridTemplateColumns).length || 1, rows = px(style.gridTemplateRows).length || 1;
    size.textContent = `${spanOf(panel.column, columns)}×${spanOf(panel.row, rows)}`;

    remove.addEventListener("click", (event) => { event.stopPropagation(); this.commit(removePanel(this.host.layout, panel.id), "Panel removed"); });
    grip.addEventListener("pointerdown", (event) => this.dragMove(event, article, panel));
    corner.addEventListener("pointerdown", (event) => this.dragResize(event, article, panel, grid));
  }

  private dragMove(event: PointerEvent, article: HTMLElement, panel: LayoutPanel): void {
    let target: HTMLElement | null = null;
    article.classList.add("is-moving");
    const mark = (next: HTMLElement | null) => {
      if (next === target) return;
      target?.classList.remove("is-drop");
      target = next;
      target?.classList.add("is-drop");
    };
    this.drag(event, {
      move: (_dx, _dy, e) => {
        const hit = document.elementsFromPoint(e.clientX, e.clientY).find((n) => n instanceof HTMLElement && n.matches(".panel") && n !== article) as HTMLElement | undefined;
        mark(hit ?? null);
      },
      end: (commit) => {
        article.classList.remove("is-moving");
        const drop = target;
        mark(null);
        if (commit && drop) this.commit(swapPanels(this.host.layout, panel.id, drop.id.replace(/^panel-/, "")), "Panels swapped");
      },
    });
  }

  private dragResize(event: PointerEvent, article: HTMLElement, panel: LayoutPanel, grid: HTMLElement): void {
    const style = getComputedStyle(grid);
    const cols = px(style.gridTemplateColumns), rows = px(style.gridTemplateRows);
    const colGap = Number.parseFloat(style.columnGap) || 0, rowGap = Number.parseFloat(style.rowGap) || 0;
    const scale = this.scale();
    const g = grid.getBoundingClientRect(), r = article.getBoundingClientRect();
    const startW = r.width / scale, startH = r.height / scale;
    const firstTrack = (sizes: number[], gap: number, offset: number) => {
      let at = 0;
      for (let i = 0; i < sizes.length; i += 1) { if (offset < at + sizes[i]! / 2) return i; at += sizes[i]! + gap; }
      return sizes.length - 1;
    };
    const c0 = firstTrack(cols, colGap, (r.left - g.left) / scale), r0 = firstTrack(rows, rowGap, (r.top - g.top) / scale);
    const best = (sizes: number[], gap: number, from: number, want: number) => {
      let pick = 1, diff = Infinity, width = 0;
      for (let k = 1; from + k <= sizes.length; k += 1) {
        width += sizes[from + k - 1]! + (k > 1 ? gap : 0);
        if (Math.abs(width - want) < diff) { diff = Math.abs(width - want); pick = k; }
      }
      return pick;
    };
    const before = { column: article.style.gridColumn, row: article.style.gridRow };
    let span = { c: spanOf(panel.column, cols.length), r: spanOf(panel.row, rows.length) };
    const size = article.querySelector(".edit-size");
    article.classList.add("is-resizing");
    this.drag(event, {
      move: (dx, dy) => {
        span = { c: best(cols, colGap, c0, startW + dx), r: best(rows, rowGap, r0, startH + dy) };
        article.style.gridColumn = withSpan(panel.column, span.c) ?? "auto";
        article.style.gridRow = withSpan(panel.row, span.r) ?? "auto";
        if (size) size.textContent = `${span.c}×${span.r}`;
      },
      end: (commit) => {
        article.classList.remove("is-resizing");
        Object.assign(article.style, { gridColumn: before.column, gridRow: before.row });
        if (commit && (span.c !== spanOf(panel.column, cols.length) || span.r !== spanOf(panel.row, rows.length))) {
          this.commit(resizePanel(this.host.layout, panel.id, span.c, span.r), `Resized to ${span.c}×${span.r}`);
        }
      },
    });
  }

  /** Pointer drag in stage pixels; Esc or a lost pointer cancels. */
  private drag(event: PointerEvent, handlers: Drag): void {
    event.preventDefault();
    event.stopPropagation();
    const scale = this.scale();
    const x0 = event.clientX, y0 = event.clientY;
    const target = event.currentTarget as HTMLElement;
    try { target.setPointerCapture(event.pointerId); } catch { /* synthetic events */ }
    this.host.root.classList.add("is-dragging");
    const move = (e: PointerEvent) => handlers.move((e.clientX - x0) / scale, (e.clientY - y0) / scale, e);
    const finish = (commit: boolean) => (e: PointerEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) {
        if (e.key !== "Escape") return;
        e.stopImmediatePropagation(); // Esc cancels the drag, not the editor
      }
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", esc, true);
      this.host.root.classList.remove("is-dragging");
      handlers.end(commit, e as PointerEvent);
    };
    const up = finish(true), cancel = finish(false), esc = finish(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", esc, true);
  }

  /* ---------------- module picker ---------------- */

  private openPicker(regionId: string, anchor: HTMLElement): void {
    this.closePicker();
    const picker = el("div", "edit-picker");
    picker.append(el("b", "", "ADD A PANEL"));
    const list = el("div", "edit-picker-list");
    for (const id of moduleIds()) {
      const module = getModule(id)!;
      const item = el("button", "edit-picker-item");
      item.type = "button";
      item.append(el("strong", "", module.title), el("span", "", module.description ?? id));
      item.addEventListener("click", (event) => {
        event.stopPropagation();
        this.closePicker();
        this.commit(addPanel(this.host.layout, regionId, id), `${module.title} added`);
      });
      list.append(item);
    }
    const close = el("button", "edit-picker-close", "CLOSE");
    close.type = "button";
    close.addEventListener("click", (event) => { event.stopPropagation(); this.closePicker(); });
    picker.append(list, close);
    const scale = this.scale(), s = this.host.stage.getBoundingClientRect(), a = anchor.getBoundingClientRect();
    picker.style.left = `${Math.min((a.left - s.left) / scale, this.host.layout.stage.width * 0.7)}px`;
    picker.style.top = `${(a.bottom - s.top) / scale + 8}px`;
    this.host.stage.append(picker);
    this.picker = picker;
  }

  private closePicker(): void {
    this.picker?.remove();
    this.picker = null;
  }

  private key(event: KeyboardEvent): void {
    if ((event.target as HTMLElement)?.closest?.("input, textarea")) return;
    if (event.key.toLowerCase() === "e" && !event.ctrlKey && !event.metaKey && !event.altKey) { this.toggle(); return; }
    if (!this.active) return;
    if (event.key === "Escape") { if (this.picker) this.closePicker(); else this.toggle(false); event.stopImmediatePropagation(); }
    else if (event.key.toLowerCase() === "z" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); this.undo(); }
  }
}
