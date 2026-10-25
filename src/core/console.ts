import { ChangeLog, type LoggedChange } from "./changes";
import { el, chipNode, setTone } from "./dom";
import { dlist, note, sec } from "./detail";
import { clockOf, dayOf, TZ } from "./format";
import { getModule } from "./registry";
import { SourceHub } from "./sources";
import type { AnyModule, ChangeEvent, DetailView, Layout, LayoutPanel, ModuleContext, Priority, RunMode, SourceState } from "./types";

interface PanelInstance {
  spec: LayoutPanel;
  region: string;
  module: AnyModule;
  article: HTMLElement;
  body: HTMLElement;
  chip: HTMLElement;
  model: unknown;
  ctx: ModuleContext | null;
  error: string | null;
}

export interface ConsoleOptions {
  layout: Layout;
  root: HTMLElement;
  mode: RunMode;
  hub?: SourceHub;
  clock?: () => number;
  storage?: Storage | null;
}

const BASELINE: Priority = {
  rank: 0, kicker: "AP3X CONSOLE", title: "All systems nominal",
  summary: "No module reports anything that outranks baseline status.", posture: "NOMINAL", tone: "good",
};

/**
 * Runs one layout: builds the stage, refreshes every source on a timer, renders
 * each module instance, picks the top-priority banner, logs changes, and hosts
 * the detail overlay. A module that throws only blanks its own panel.
 */
export class Console {
  readonly layout: Layout;
  readonly changes: ChangeLog;
  private panels: PanelInstance[] = [];
  private hub: SourceHub;
  private clock: () => number;
  private storage: Storage | null;
  private stage!: HTMLElement;
  private overlay!: HTMLElement;
  private detailId: string | null = null;
  private detailState = new Map<string, Record<string, unknown>>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private changeDay: string | null;
  private changesSeen = 0;

  constructor(private options: ConsoleOptions) {
    this.layout = options.layout;
    this.hub = options.hub ?? new SourceHub();
    this.clock = options.clock ?? Date.now;
    this.storage = options.storage === undefined ? safeStorage() : options.storage;
    this.changeDay = dayOf(new Date(this.clock()).toISOString(), TZ);
    const saved = this.load("changes");
    this.changes = saved && (saved as { day?: string }).day === this.changeDay
      ? ChangeLog.from((saved as { items?: unknown }).items) : new ChangeLog();
    this.changesSeen = this.changes.total;
  }

  mount(): this {
    const { layout, root } = this.options;
    root.replaceChildren();
    root.classList.add("console");
    root.dataset.layout = layout.id;
    this.stage = el("div", "stage");
    Object.assign(this.stage.style, { width: `${layout.stage.width}px`, height: `${layout.stage.height}px`, fontSize: `${layout.stage.fontSize}px` });
    this.stage.append(this.buildTopbar(), this.buildRegions(), this.buildOverlay());
    root.append(this.stage);
    this.fit();
    window.addEventListener("resize", () => this.fit());
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") this.closeDetail(); });
    return this;
  }

  async start(): Promise<void> {
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), (this.layout.refreshSeconds ?? 30) * 1000);
    setInterval(() => this.tickClock(), 1000);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  /** One refresh: fetch (or load demo payloads), rebuild every module model, render, rank, log. */
  async refresh(): Promise<void> {
    const now = this.clock();
    const states = this.options.mode === "demo" ? this.hub.fromPayloads(this.demoPayloads(now)) : await this.hub.refresh();
    const priorities: Priority[] = [];
    const events: ChangeEvent[] = [];
    for (const panel of this.panels) {
      const ctx = this.contextFor(panel, states, now);
      const previous = panel.error ? null : panel.model;
      try {
        const model = panel.module.model(ctx);
        panel.module.render(panel.body, model, ctx);
        const chip = panel.module.chip?.(model);
        panel.chip.replaceWith(panel.chip = chip ? chipNode(chip.label, chip.tone) : chipNode("—", "muted"));
        const priority = panel.module.priority?.(model);
        if (priority) priorities.push(priority);
        if (previous !== null && panel.ctx && panel.module.changes && this.options.mode === "live") events.push(...panel.module.changes(previous, model));
        panel.model = model;
        panel.ctx = ctx;
        panel.error = null;
        panel.article.classList.remove("has-error");
      } catch (error) {
        panel.error = error instanceof Error ? error.message : String(error);
        panel.article.classList.add("has-error");
        panel.body.replaceChildren(el("p", "module-error", `${panel.module.title} could not render: ${panel.error}`));
        console.error(`[console] ${panel.spec.id} (${panel.module.id})`, error);
      }
    }
    this.showPriority(priorities.sort((a, b) => b.rank - a.rank)[0] ?? BASELINE);
    this.logChanges(events, now);
    if (this.detailId) this.buildDetail();
  }

  openDetail(panelId: string): void {
    const panel = this.panels.find((p) => p.spec.id === panelId);
    if (panelId !== "changes" && !panel?.module.detail) return;
    this.detailId = panelId;
    this.overlay.hidden = false;
    this.buildDetail();
  }

  closeDetail(): void {
    this.detailId = null;
    this.overlay.hidden = true;
  }

  // ---------------------------------------------------------------- building

  private buildTopbar(): HTMLElement {
    const bar = el("header", "topbar");
    const brand = el("div", "brand");
    brand.append(el("b", "brand-title", this.layout.title), el("span", "brand-sub", this.options.mode === "demo" ? "AP3X CONSOLE · DEMO DATA" : "AP3X CONSOLE"));
    const priority = el("div", "priority");
    priority.id = "console-priority";
    const changes = el("button", "changes-button", "CHANGES 0");
    changes.type = "button";
    changes.id = "console-changes";
    changes.addEventListener("click", () => this.openDetail("changes"));
    const clock = el("div", "clock");
    clock.id = "console-clock";
    bar.append(brand, priority, changes, clock);
    return bar;
  }

  private buildRegions(): HTMLElement {
    const regions = el("main", "regions");
    regions.style.gridTemplateColumns = this.layout.regionColumns;
    this.layout.regions.forEach((region, index) => {
      const column = el("section", "region");
      column.dataset.region = region.id;
      const head = el("div", "region-head");
      head.append(el("span", "region-index", String(index + 1).padStart(2, "0")), el("span", "", region.title));
      const grid = el("div", "region-grid");
      Object.assign(grid.style, { gridTemplateColumns: region.columns, gridTemplateRows: region.rows });
      for (const spec of region.panels) {
        const module = getModule(spec.module);
        if (!module) throw new Error(`layout ${this.layout.id}: unknown module ${spec.module}`);
        for (const source of module.sources) this.hub.register(source);
        const article = el("article", `panel module-${module.id}`);
        article.id = `panel-${spec.id}`;
        if (spec.column) article.style.gridColumn = spec.column;
        if (spec.row) article.style.gridRow = spec.row;
        const header = el("header");
        const chip = chipNode("—", "muted");
        header.append(el("h3", "", spec.title ?? module.title), chip);
        const body = el("div", "panel-body");
        article.append(header, body);
        if (module.detail) {
          article.classList.add("has-detail");
          article.addEventListener("click", (event) => {
            if (!(event.target as HTMLElement).closest("button, a")) this.openDetail(spec.id);
          });
        }
        grid.append(article);
        this.panels.push({ spec, region: region.id, module, article, body, chip, model: null, ctx: null, error: null });
      }
      column.append(head, grid);
      regions.append(column);
    });
    return regions;
  }

  private buildOverlay(): HTMLElement {
    this.overlay = el("div", "detail-overlay");
    this.overlay.hidden = true;
    this.overlay.addEventListener("click", (event) => { if (event.target === this.overlay) this.closeDetail(); });
    return this.overlay;
  }

  private buildDetail(): void {
    const id = this.detailId;
    if (!id) return;
    let view: DetailView;
    let tabsFrom: PanelInstance[] = [];
    if (id === "changes") {
      view = this.changesView();
    } else {
      const panel = this.panels.find((p) => p.spec.id === id);
      if (!panel?.module.detail || !panel.ctx || panel.error) { this.closeDetail(); return; }
      const state = this.detailState.get(id) ?? {};
      this.detailState.set(id, state);
      try {
        view = panel.module.detail(panel.model, panel.ctx, { rebuild: () => this.buildDetail(), state });
      } catch (error) {
        view = { title: panel.module.title, columns: "1fr", rows: "1fr", sections: [note(`Detail view failed: ${error instanceof Error ? error.message : error}`)] };
      }
      tabsFrom = this.panels.filter((p) => p.region === panel.region && p.module.detail);
    }
    const card = el("div", "detail");
    const head = el("header", "detail-head");
    const title = el("div", "detail-title");
    title.append(el("h2", "", view.title));
    if (view.chip) title.append(chipNode(view.chip.label, view.chip.tone));
    const tabs = el("nav", "detail-tabs");
    for (const panel of tabsFrom) {
      const tab = el("button", panel.spec.id === id ? "tab is-active" : "tab", (panel.spec.title ?? panel.module.title).toUpperCase());
      tab.type = "button";
      tab.addEventListener("click", () => this.openDetail(panel.spec.id));
      tabs.append(tab);
    }
    const close = el("button", "tab close", "CLOSE");
    close.type = "button";
    close.addEventListener("click", () => this.closeDetail());
    head.append(title, tabs, close);
    const body = el("div", "detail-body");
    Object.assign(body.style, { gridTemplateColumns: view.columns, gridTemplateRows: view.rows });
    body.append(...view.sections);
    const foot = el("footer", "detail-foot");
    foot.append(el("span", "", view.foot ?? ""), el("span", "", "ESC OR CLICK OUTSIDE TO CLOSE"));
    card.append(head, body, foot);
    this.overlay.replaceChildren(card);
  }

  // ---------------------------------------------------------------- runtime helpers

  private contextFor(panel: PanelInstance, states: Record<string, SourceState>, now: number): ModuleContext {
    const missing = (id: string): SourceState => ({ id, status: "unknown", data: null, ageMs: null, fetchedAt: null, seen: false });
    const sources = Object.fromEntries(panel.module.sources.map((s) => [s.id, states[s.id] ?? missing(s.id)]));
    return { now, mode: this.options.mode, settings: { ...(panel.module.defaults ?? {}), ...(panel.spec.settings ?? {}) }, sources, stageWidth: this.layout.stage.width };
  }

  private demoPayloads(now: number): Record<string, unknown> {
    const payloads: Record<string, unknown> = {};
    // Modules sharing a feed may each describe part of it (host: system figures, services: the
    // service list). Objects merge key by key; a full contract (schema_version / contract) takes
    // precedence over a partial stub, and the first module's value wins on a conflicting key.
    const full = (value: unknown) => Boolean(value) && typeof value === "object" && ("schema_version" in (value as object) || "contract" in (value as object));
    const plain = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
    for (const panel of this.panels) {
      for (const [id, value] of Object.entries(panel.module.demo?.(now) ?? {})) {
        const current = payloads[id];
        if (!(id in payloads)) payloads[id] = value;
        else if (full(value) && !full(current)) payloads[id] = plain(current) && plain(value) ? { ...current, ...value } : value;
        else if (plain(current) && plain(value)) payloads[id] = { ...value, ...current };
      }
    }
    return payloads;
  }

  private showPriority(priority: Priority): void {
    const node = this.stage.querySelector<HTMLElement>("#console-priority");
    if (!node) return;
    setTone(node, priority.tone);
    node.dataset.tone = priority.tone;
    const copy = el("div", "priority-copy");
    copy.append(el("small", "", priority.kicker), el("b", "", priority.title), el("span", "", priority.summary));
    const posture = el("div", "priority-posture");
    posture.append(el("small", "", "POSTURE"), el("b", "", priority.posture));
    node.replaceChildren(copy, posture);
  }

  private logChanges(events: ChangeEvent[], now: number): void {
    const today = dayOf(new Date(now).toISOString(), TZ);
    if (today !== this.changeDay) { this.changes.clear(); this.changeDay = today; this.changesSeen = 0; }
    if (events.length) {
      this.changes.add(events, now);
      this.save("changes", { day: this.changeDay, items: this.changes.toJSON() });
    }
    const button = this.stage.querySelector<HTMLElement>("#console-changes");
    if (button) {
      button.textContent = `CHANGES ${this.changes.entries.length}`;
      button.classList.toggle("has-new", this.changes.total > this.changesSeen);
    }
  }

  private changesView(): DetailView {
    this.changesSeen = this.changes.total;
    const entries: readonly LoggedChange[] = this.changes.entries;
    return {
      title: "TODAY'S CHANGES",
      chip: { label: `${entries.length} TODAY`, tone: entries.some((c) => c.tone === "bad") ? "bad" : entries.length ? "info" : "good" },
      foot: "Differences between refreshes since midnight · kept on this screen for the day",
      columns: "minmax(0, 1fr)", rows: "minmax(0, 1fr)",
      sections: [sec("TIMELINE · NEWEST FIRST", entries.length ? dlist(entries.slice(0, 16).map((c) => ({
        title: c.count > 1 ? `${c.text}  ×${c.count}` : c.text,
        detail: c.count > 1 ? `${c.count} times today · first ${clockOf(new Date(c.first).toISOString())} · latest ${clockOf(new Date(c.at).toISOString())}` : clockOf(new Date(c.at).toISOString()),
        tag: c.kicker, tone: c.tone,
      }))) : note("Nothing has changed since the console started today."))],
    };
  }

  private tickClock(): void {
    const node = this.stage.querySelector<HTMLElement>("#console-clock");
    if (node) node.textContent = clockOf(new Date(this.clock()).toISOString());
  }

  /** Scale the fixed stage to fit the window, centered. */
  private fit(): void {
    const { width, height } = this.layout.stage;
    const scale = Math.min(window.innerWidth / width, window.innerHeight / height);
    this.stage.style.setProperty("--scale", String(scale > 0 && Number.isFinite(scale) ? scale : 1));
    this.tickClock();
  }

  private load(key: string): unknown {
    try { return JSON.parse(this.storage?.getItem(`console-${this.layout.id}-${key}`) ?? "null"); } catch { return null; }
  }

  private save(key: string, value: unknown): void {
    try { this.storage?.setItem(`console-${this.layout.id}-${key}`, JSON.stringify(value)); } catch { /* optional */ }
  }
}

function safeStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}
