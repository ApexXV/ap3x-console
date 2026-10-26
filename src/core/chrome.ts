import { el } from "./dom";
import { TZ } from "./format";
import type { Layout, RunMode } from "./types";

/* The wall's controls, for layouts that ask for them: the command dock (layout focus, refresh,
 * changes, motion, sources, open-wall drawer), the night and privacy toggles, keyboard shortcuts,
 * and Lively Wallpaper properties. Choices are remembered in this browser. */

export interface ChromeHost {
  layout: Layout;
  root: HTMLElement;
  stage: HTMLElement;
  mode: RunMode;
  storage: Storage | null;
  refresh(): void;
  openDetail(id: string): void;
  closeDetail(): void;
  setRegionColumns(columns: string): void;
}

const MOTION_LEVELS = ["full", "low", "off"] as const;
type Motion = typeof MOTION_LEVELS[number];
const NIGHT_KEY = "console-night";
const ICONS = {
  sun: '<svg class="i-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1"/></svg>',
  moon: '<svg class="i-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.6A8.5 8.5 0 0 1 9.4 3.5a8.5 8.5 0 1 0 11.1 11.1z"/></svg>',
  eye: '<svg class="i-eye" viewBox="0 0 24 24" aria-hidden="true"><path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3.2"/></svg>',
  eyeOff: '<svg class="i-eye-off" viewBox="0 0 24 24" aria-hidden="true"><path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z"/><path d="M3 21L21 3"/></svg>',
};

function button(label: string, title: string, onClick: () => void, className = ""): HTMLButtonElement {
  const node = el("button", className, label);
  node.type = "button";
  node.title = title;
  node.addEventListener("click", (event) => { event.stopPropagation(); onClick(); });
  return node;
}

export function scheduledNight(ms: number): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(new Date(ms)));
  return hour >= 22 || hour < 8;
}

/** The next 22:00 or 08:00 switch after `now`. */
export function nextBoundary(now: number): number {
  const start = scheduledNight(now);
  for (let t = Math.ceil(now / 60_000) * 60_000; t < now + 16 * 3_600_000; t += 60_000) {
    if (scheduledNight(t) !== start) return t;
  }
  return now + 10 * 3_600_000;
}

export class Chrome {
  private params = new URLSearchParams(location.search);
  private privacyDefaultOn = this.params.get("privacy") === "on";
  private privacyIdle: ReturnType<typeof setTimeout> | undefined;
  private nightDetail: { night?: boolean; overrideMode?: string | null } | null = null;
  private focusButtons: HTMLButtonElement[] = [];
  private motionButton: HTMLButtonElement | null = null;
  private nightButton: HTMLButtonElement | null = null;
  private privacyButton: HTMLButtonElement | null = null;
  private modeLine: HTMLElement | null = null;
  private drawer: HTMLElement | null = null;
  focus = "balanced";

  constructor(private host: ChromeHost) {}

  /* ---------------- building ---------------- */

  /** The sun/moon and eye buttons that sit beside the layout title. */
  toggles(): HTMLElement {
    const wrap = el("span", "brand-toggles");
    if (this.host.layout.nightMode) {
      this.nightButton = button("", "Toggle night mode on this screen (N)", () => this.toggleNight(), "icon-toggle night-toggle");
      this.nightButton.innerHTML = ICONS.sun + ICONS.moon;
      wrap.append(this.nightButton);
    }
    this.privacyButton = button("", "Hide dollar amounts (P)", () => this.setPrivacy(this.host.root.dataset.privacy !== "on", true), "icon-toggle privacy-toggle");
    this.privacyButton.innerHTML = ICONS.eye + ICONS.eyeOff;
    wrap.append(this.privacyButton);
    return wrap;
  }

  /** The command dock: layout focus, refresh, changes, motion, sources; then the open-wall links. */
  dock(changesButton: HTMLElement): HTMLElement {
    const { layout } = this.host;
    const nav = el("nav", "dock");
    nav.setAttribute("aria-label", "Command dock");
    const row = el("div", "dock-row");
    row.append(el("span", "dock-label", "LAYOUT"));
    if (layout.focus) {
      layout.regions.forEach((region, index) => {
        if (!layout.focus?.[region.id]) return;
        const b = button(region.short ?? region.title.split(" ").pop()!, `Widen ${region.title.toLowerCase()} (${index + 1})`, () => this.setFocus(region.id));
        b.dataset.focusSet = region.id;
        this.focusButtons.push(b);
        row.append(b);
      });
      const balanced = button("BALANCED", "Balanced layout (0)", () => this.setFocus("balanced"));
      balanced.dataset.focusSet = "balanced";
      this.focusButtons.push(balanced);
      row.append(balanced);
    }
    this.motionButton = button("MOTION · FULL", "Cycle motion (M)", () => this.setMotion(MOTION_LEVELS[(MOTION_LEVELS.indexOf(this.motion) + 1) % MOTION_LEVELS.length]!));
    row.append(button("REFRESH", "Refresh now (R)", () => this.host.refresh()), changesButton, this.motionButton,
      button("SOURCES", "Every feed this layout reads, with its status (S)", () => this.host.openDetail("sources")));
    nav.append(row);
    if (layout.links?.length) {
      const links = el("div", "dock-row");
      links.append(el("span", "dock-label", "OPEN WALL"));
      for (const link of layout.links) links.append(button(link.label, `Open ${link.title}${link.key ? ` (${link.key.toUpperCase()})` : ""}`, () => this.openDrawer(link.href, link.title)));
      nav.append(links);
    }
    return nav;
  }

  /** The DAY / NIGHT MODE line under the clock. */
  clockMode(): HTMLElement {
    this.modeLine = el("div", "clock-mode", "DAY");
    return this.modeLine;
  }

  /** A side drawer that shows another wall page at 1920×1080, scaled to fit. */
  drawerElement(): HTMLElement {
    const drawer = el("aside", "drawer");
    drawer.setAttribute("aria-hidden", "true");
    const head = el("header");
    head.append(el("b", "drawer-title", ""), button("CLOSE", "Close (Esc)", () => this.closeDrawer()));
    const viewport = el("div", "drawer-viewport");
    viewport.append(el("iframe"));
    drawer.append(head, viewport);
    this.drawer = drawer;
    return drawer;
  }

  /* ---------------- start ---------------- */

  start(): void {
    const { layout, root } = this.host;
    if (layout.nightMode) this.loadSharedNightMode();
    this.setMotion((this.params.get("motion") as Motion) || (this.load("motion") as Motion) ||
      (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "low" : "full"), false);
    this.setPrivacy(this.privacyDefaultOn || this.load("privacy") === "on", false);
    document.addEventListener("pointermove", () => { if (this.privacyDefaultOn && root.dataset.privacy === "off") this.armPrivacyIdle(); }, { passive: true });
    if (layout.focus) this.setFocus(this.params.get("focus") || (this.load("focus") as string | null) || "balanced", false);
    if (layout.nightMode) {
      window.addEventListener("wall-display-mode-change", (event) => {
        this.nightDetail = ((event as CustomEvent).detail ?? null) as typeof this.nightDetail;
        this.applyNight();
      });
      setInterval(() => this.applyNight(), 30_000);
      this.applyNight();
    }
    document.addEventListener("keydown", (event) => this.key(event));
    // Lively Wallpaper calls this with LivelyProperties.json values when the shell page forwards them.
    (window as unknown as { livelyPropertyListener: (name: string, value: unknown) => void }).livelyPropertyListener = (name, value) => {
      if (name === "motion") this.setMotion(MOTION_LEVELS[Number(value)] ?? (String(value) as Motion));
      else if (name === "focus") this.setFocus(["balanced", ...layout.regions.map((r) => r.id)][Number(value)] ?? String(value));
      else if (name === "privacy") this.setPrivacy(Number(value) === 1 || value === true || value === "on", true);
    };
  }

  /* ---------------- motion ---------------- */

  get motion(): Motion {
    return (this.host.root.dataset.motion as Motion) || "full";
  }

  setMotion(level: Motion, remember = true): void {
    const value = MOTION_LEVELS.includes(level) ? level : "full";
    this.host.root.dataset.motion = value;
    if (this.motionButton) this.motionButton.textContent = `MOTION · ${value.toUpperCase()}`;
    if (remember) this.save("motion", value);
  }

  /* ---------------- privacy: blur dollar amounts ----------------
   * ?privacy=on (a work screen) starts every load private, and turning it off there lasts only
   * until 5 idle minutes. Elsewhere the choice is remembered. Hover a blurred figure to peek. */

  setPrivacy(on: boolean, remember: boolean): void {
    this.host.root.dataset.privacy = on ? "on" : "off";
    if (this.privacyButton) {
      this.privacyButton.setAttribute("aria-pressed", String(on));
      this.privacyButton.title = on ? "Show dollar amounts (P) · hover a blurred figure to peek" : "Hide dollar amounts (P)";
    }
    if (remember && !this.privacyDefaultOn) this.save("privacy", on ? "on" : "off");
    clearTimeout(this.privacyIdle);
    if (!on && this.privacyDefaultOn) this.armPrivacyIdle();
  }

  private armPrivacyIdle(): void {
    clearTimeout(this.privacyIdle);
    this.privacyIdle = setTimeout(() => this.setPrivacy(true, false), 5 * 60_000);
  }

  /* ---------------- focus: widen one region ---------------- */

  setFocus(focus: string, remember = true): void {
    const { layout } = this.host;
    const valid = focus === "balanced" || Boolean(layout.focus?.[focus]);
    this.focus = valid ? focus : "balanced";
    this.host.root.dataset.focus = this.focus;
    this.host.setRegionColumns(this.focus === "balanced" ? layout.regionColumns : layout.focus![this.focus]!);
    for (const b of this.focusButtons) b.classList.toggle("is-active", b.dataset.focusSet === this.focus);
    if (remember) this.save("focus", this.focus);
  }

  /** Region heads widen their region; clicking the widened one again returns to balanced. */
  regionHeadClick(regionId: string): void {
    if (!this.host.layout.focus?.[regionId]) return;
    this.setFocus(this.focus === regionId ? "balanced" : regionId);
  }

  /* ---------------- night mode ----------------
   * rackmain1's shared wall-night-mode script owns the 22:00–08:00 schedule and the Pulse
   * override; this screen can only read it. The sun/moon button sets a local choice that lasts
   * until the next 22:00 / 08:00 switch, like a Pulse override. */

  private loadSharedNightMode(): void {
    if (document.querySelector("script[data-wall-night]")) return;
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "/shared/wall-night-mode.css";
    const script = document.createElement("script");
    script.src = "/shared/wall-night-mode.js";
    script.dataset.wallNight = "";
    script.onerror = () => { /* not on this host (dev, another server): the local schedule still applies */ };
    document.head.append(css, script);
  }

  private localNight(): { night: boolean; until: number } | null {
    const saved = this.load(NIGHT_KEY, true) as { night?: unknown; until?: unknown } | null;
    if (saved && typeof saved.night === "boolean" && typeof saved.until === "number" && saved.until > Date.now()) return { night: saved.night, until: saved.until };
    if (saved) this.save(NIGHT_KEY, null, true);
    return null;
  }

  applyNight(): void {
    const html = document.documentElement;
    const local = this.localNight();
    const shared = this.nightDetail ?? { night: scheduledNight(Date.now()), overrideMode: null };
    const night = local ? local.night : html.classList.contains("wall-night-mode") || (!this.nightDetail && Boolean(shared.night));
    if (local || !this.nightDetail) html.classList.toggle("wall-night-mode", night);
    const until = local ? new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(local.until) : null;
    if (this.modeLine) {
      this.modeLine.textContent = local ? `${night ? "NIGHT MODE" : "DAY"} · THIS SCREEN UNTIL ${until}`
        : shared.night ? `NIGHT MODE · ${shared.overrideMode ? "PULSE OVERRIDE" : "22:00–08:00"}` : shared.overrideMode ? "DAY · PULSE OVERRIDE" : "DAY";
    }
    if (this.nightButton) {
      this.nightButton.classList.toggle("is-manual", Boolean(local));
      this.nightButton.setAttribute("aria-pressed", String(night));
      this.nightButton.title = local ? `Night mode ${night ? "on" : "off"} on this screen until ${until} · click to ${night ? "turn off" : "turn on"} (N)`
        : `Turn night mode ${night ? "off" : "on"} on this screen until the next 22:00 / 08:00 switch (N)`;
    }
  }

  toggleNight(): void {
    const html = document.documentElement;
    const night = !html.classList.contains("wall-night-mode");
    const now = Date.now();
    // Choosing what the schedule already wants simply clears the local choice.
    const choice = night === scheduledNight(now) && !this.nightDetail?.overrideMode ? null : { night, until: nextBoundary(now) };
    html.classList.add("wall-night-transition");
    setTimeout(() => html.classList.remove("wall-night-transition"), 1500);
    this.save(NIGHT_KEY, choice, true);
    html.classList.toggle("wall-night-mode", night);
    if (!choice && this.nightDetail) this.nightDetail = { ...this.nightDetail, night };
    this.applyNight();
  }

  /* ---------------- drawer ---------------- */

  openDrawer(path: string, title: string): void {
    if (!this.drawer) return;
    const frame = this.drawer.querySelector("iframe")!;
    const src = path + (this.host.mode === "demo" ? (path.includes("?") ? "&demo" : "?demo") : "");
    if (frame.getAttribute("src") !== src) frame.setAttribute("src", src);
    this.drawer.querySelector(".drawer-title")!.textContent = title.toUpperCase();
    this.drawer.classList.add("is-open");
    this.drawer.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => this.fitDrawer());
  }

  closeDrawer(): void {
    if (!this.drawer?.classList.contains("is-open")) return;
    this.drawer.classList.remove("is-open");
    this.drawer.setAttribute("aria-hidden", "true");
    const frame = this.drawer.querySelector("iframe")!;
    setTimeout(() => { if (!this.drawer?.classList.contains("is-open")) frame.removeAttribute("src"); }, 800);
  }

  fitDrawer(): void {
    const viewport = this.drawer?.querySelector<HTMLElement>(".drawer-viewport");
    if (!viewport) return;
    const scale = Math.min(viewport.clientWidth / 1920, viewport.clientHeight / 1080);
    viewport.style.setProperty("--frame-scale", String(scale > 0 ? scale : 1));
  }

  /* ---------------- keyboard ---------------- */

  private key(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey || (event.target as HTMLElement)?.closest?.("input, textarea")) return;
    const { layout } = this.host;
    const key = event.key.toLowerCase();
    if (key === "escape") { this.closeDrawer(); this.host.closeDetail(); return; }
    if (layout.focus && /^[0-9]$/.test(key)) {
      const region = key === "0" ? "balanced" : layout.regions[Number(key) - 1]?.id;
      if (region) this.setFocus(region);
      return;
    }
    if (key === "r") this.host.refresh();
    else if (key === "c") this.host.openDetail("changes");
    else if (key === "s") this.host.openDetail("sources");
    else if (key === "n" && layout.nightMode) this.toggleNight();
    else if (key === "p") this.setPrivacy(this.host.root.dataset.privacy !== "on", true);
    else if (key === "m") this.setMotion(MOTION_LEVELS[(MOTION_LEVELS.indexOf(this.motion) + 1) % MOTION_LEVELS.length]!);
    else {
      const link = layout.links?.find((l) => l.key === key);
      if (link) this.openDrawer(link.href, link.title);
    }
  }

  /* ---------------- storage ---------------- */

  private load(key: string, json = false): unknown {
    try {
      const value = this.host.storage?.getItem(json ? key : `console-${this.host.layout.id}-${key}`) ?? null;
      return json ? JSON.parse(value ?? "null") : value;
    } catch { return null; }
  }

  private save(key: string, value: unknown, json = false): void {
    try {
      const name = json ? key : `console-${this.host.layout.id}-${key}`;
      if (value === null) this.host.storage?.removeItem(name);
      else this.host.storage?.setItem(name, json ? JSON.stringify(value) : String(value));
    } catch { /* storage may be unavailable in Lively */ }
  }
}
