/* AP3X Console core types: modules, data sources, layouts.
 *
 * A module turns one or more JSON data contracts into a compact panel and an
 * optional detail view. Layouts place module instances on a fixed-size stage.
 * Nothing here knows about a specific feed; modules own their contracts. */

export type Tone = "good" | "warn" | "bad" | "info" | "muted";

/** A JSON feed a module reads. Modules that share a feed declare the same id and url. */
export interface SourceSpec {
  id: string;
  url: string;
  /** `schema_version` the payload must carry; anything else is reported as invalid by the module. */
  schema?: string;
  /** Timestamp field checked against `maxAgeMs` (usually `generated_at`). */
  stampField?: string;
  maxAgeMs?: number;
  /** An optional feed is not reported as down until it has answered at least once. */
  optional?: boolean;
}

export type SourceStatus = "ok" | "retained" | "stale" | "down" | "unknown";

export interface SourceState {
  id: string;
  status: SourceStatus;
  data: unknown;
  /** Age of the payload's own timestamp (stampField), when it has one. */
  ageMs: number | null;
  /** When the last successful fetch happened (epoch ms). */
  fetchedAt: number | null;
  /** True once this source has answered at least once since the page loaded. */
  seen: boolean;
  /** Round-trip time of this refresh's fetch, when it was fresh (not retained or demo). */
  latencyMs?: number | null;
}

export interface Chip {
  label: string;
  tone: Tone;
  /** Blurred in privacy mode (amounts). */
  private?: boolean;
}

/** One line for the Changes timeline. Repeats merge by kicker + text. */
export interface ChangeEvent {
  tone: Tone;
  kicker: string;
  text: string;
}

/** One item for the bottom ticker. `hot` items (today / tonight) lead; the rest follow by `order`. */
export interface TickerItem {
  label: string;
  value: string;
  hot?: boolean;
  /** Blurred in privacy mode (dollar amounts). */
  private?: boolean;
  /** Lower first among non-hot items (business 10s, FM 20s, markets 30s, feed 40s, weather 50s). */
  order?: number;
}

/** A candidate for the top banner. The highest `rank` across all modules wins. */
export interface Priority {
  rank: number;
  kicker: string;
  title: string;
  summary: string;
  posture: string;
  tone: Tone;
}

export type RunMode = "live" | "demo";

export interface ModuleContext<S = Record<string, unknown>> {
  now: number;
  mode: RunMode;
  /** Layout-level settings merged over the module's defaults. */
  settings: S;
  /** Only the sources this module declared, by id. */
  sources: Record<string, SourceState>;
  /** Stage width in px, so a module can choose denser rendering on small stages. */
  stageWidth: number;
}

export interface DetailView {
  title: string;
  chip?: Chip;
  foot?: string;
  /** CSS grid templates for the detail body. */
  columns: string;
  rows: string;
  sections: HTMLElement[];
}

/** Hooks a detail builder can use for interactive views (paging, expanding a row). */
export interface DetailHooks {
  rebuild(): void;
  /** Per-module scratch state that survives rebuilds and refreshes while the detail view is open. */
  state: Record<string, unknown>;
}

export interface ModuleManifest<M = unknown, S extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  title: string;
  description: string;
  version: string;
  sources: SourceSpec[];
  defaults?: S;
  /** Pure: source payloads → view model. Must tolerate missing, stale, or malformed payloads. */
  model(ctx: ModuleContext<S>): M;
  /** Fills the panel body. Called on every refresh with a fresh model. */
  render(body: HTMLElement, model: M, ctx: ModuleContext<S>): void;
  chip?(model: M): Chip;
  /** A one-line summary for the region head, when the layout asks this panel for one (null = no opinion). */
  regionChip?(model: M, ctx: ModuleContext<S>): Chip | null;
  detail?(model: M, ctx: ModuleContext<S>, hooks: DetailHooks): DetailView;
  /** Demo payloads by source id, for previews and screenshots. */
  demo?(now: number): Record<string, unknown>;
  changes?(previous: M, next: M): ChangeEvent[];
  /** Items for the layout's bottom ticker, if it has one. */
  ticker?(model: M, ctx: ModuleContext<S>): TickerItem[];
  priority?(model: M): Priority | null;
}

/** Erased manifest type used by the registry and console. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyModule = ModuleManifest<any, any>;

export interface LayoutPanel {
  /** Unique within the layout; used for DOM ids and saved state. */
  id: string;
  module: string;
  /** CSS grid placement inside the region, e.g. { column: "1 / -1", row: "4" }. */
  column?: string;
  row?: string;
  /** Overrides the module title in the panel header. */
  title?: string;
  settings?: Record<string, unknown>;
}

export interface LayoutRegion {
  id: string;
  title: string;
  /** Short name for dock buttons and page tabs (defaults to the title's last word). */
  short?: string;
  /** CSS grid templates for the region's panel grid. */
  columns: string;
  rows: string;
  /** Panel ids whose module summarises the region in its head; the first with something to say wins. */
  chipFrom?: string[];
  panels: LayoutPanel[];
}

export interface Layout {
  id: string;
  title: string;
  /** Fixed stage the layout is designed for; it is scaled to fit any screen. */
  stage: { width: number; height: number; fontSize: number };
  /** CSS grid template for the regions, left to right. */
  regionColumns: string;
  regions: LayoutRegion[];
  refreshSeconds?: number;
  /** "columns" (default) shows every region side by side; "pages" shows one region at a time
   *  with a touch tab bar, for small screens; "tabs" shows one region at a time, switched from
   *  the dock (the wall's 1080p mode). */
  navigation?: "columns" | "pages" | "tabs";
  /** Tabs only: the region shown first and for "balanced" (defaults to the first region). */
  defaultRegion?: string;
  /** "compact" shrinks the top bar to one line (title, priority, clock) for small screens. */
  chrome?: "full" | "compact";
  /** Pages only: return to the first page after this many seconds without a touch. */
  homeAfterSeconds?: number;
  /** "24h" (default) or "12h" for every time shown, e.g. "6:07 PM" on a shared lab screen. */
  clock?: "12h" | "24h";
  /** Show the command dock (layout focus, refresh, motion, sources, and `links`) in the top bar. */
  dock?: boolean;
  /** Region id → regionColumns used while that region is widened from the dock (keys 1, 2, 3…). */
  focus?: Record<string, string>;
  /** Other wall pages the dock can open in a side drawer (same origin paths). */
  links?: { label: string; href: string; title: string; key?: string }[];
  /** A same-origin logo image shown before the title (hidden if it fails to load). */
  logo?: string;
  /** A scrolling ticker along the bottom: today / tonight items first, then module items. */
  ticker?: boolean;
  /** Follow the shared 22:00–08:00 night mode (rackmain1's /shared/wall-night-mode.js) with a local toggle. */
  nightMode?: boolean;
  /** The floating now-playing tile for the wall playlist (/music/…). */
  music?: boolean;
}
