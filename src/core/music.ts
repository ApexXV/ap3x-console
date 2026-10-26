import { asDict, num, record, text } from "./format";
import { el } from "./dom";

/* The now-playing tile for the wall playlist written by ap3x-kiosk-displays
 * deploy/lofi_tokyo_playlist.py (/music/lofi-tokyo/tracks.json, or /playlist.json). It can be
 * dragged anywhere and minimized into a side tab; position, volume, track, time, and play/pause
 * are remembered in this browser (shared with nothing else). The tile stays hidden without a
 * playlist. Volume steps: 0, BG (3 %), 10–100. */

interface Track { url: string; title: string; artist: string | null; album: string; cover: string | null }
interface Saved { x?: number; y?: number; volume?: number; url?: string; time?: number; on?: boolean; min?: boolean }

const KEY = "console-music";
const EMBLEM = "/command-57-assets/ap3x-symbol-reversed.png";
const BG_LEVEL = 3;
const DEFAULT_VOLUME = 0.1;
const ICON = {
  min: '<svg viewBox="0 0 24 24"><path d="M5 11h14v2H5z"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path class="i-play" d="M7 4l13 8-13 8z"/><path class="i-pause" d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg>',
};

export function clockTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export async function loadTracks(fetcher: typeof fetch = fetch): Promise<{ tracks: Track[]; version: string | null }> {
  const get = async (url: string) => {
    try {
      const response = await fetcher(url, { cache: "no-store" });
      return response.ok ? await response.json() : null;
    } catch { return null; }
  };
  const detailed = asDict(await get("/music/lofi-tokyo/tracks.json"));
  const version = text(detailed.generated_at);
  if (Array.isArray(detailed.tracks) && detailed.tracks.length) {
    return {
      version,
      tracks: detailed.tracks.filter(record).filter((t) => typeof t.url === "string" && t.url.startsWith("/music/")).map((t) => ({
        url: t.url as string, title: text(t.title) ?? "Untitled", artist: text(t.artist), album: text(t.album, detailed.album) ?? "LoFi Tokyo",
        cover: typeof t.cover === "string" && t.cover.startsWith("/music/") ? t.cover : null,
      })),
    };
  }
  const plain = await get("/playlist.json");
  return {
    version,
    tracks: Array.isArray(plain) ? plain.filter((u): u is string => typeof u === "string" && u.startsWith("/music/")).map((url) => ({
      url, title: decodeURIComponent(url.split("/").pop()!).replace(/\.[a-z0-9]+$/i, "").replace(/^\d+[-_ .]+/, "").replace(/[-_]+/g, " "),
      artist: null, album: "Wall playlist", cover: null,
    })) : [],
  };
}

function iconButton(className: string, title: string, svg: string): HTMLButtonElement {
  const b = el("button", className);
  b.type = "button";
  b.title = title;
  b.setAttribute("aria-label", title);
  b.innerHTML = svg;
  return b;
}

export class MusicTile {
  private tracks: Track[] = [];
  private version: string | null = null;
  private index = 0;
  private errors = 0;
  private state: Saved = {};
  private audio = el("audio");
  readonly tile = el("section", "music-tile");
  readonly tab = el("button", "music-tab");
  private steps = el("div", "music-vol-steps");
  private volumeButton = el("button", "music-volume", "VOL 10");

  constructor(private stage: HTMLElement, private size: { width: number; height: number }, private storage: Storage | null) {
    this.tile.hidden = true;
    this.tab.hidden = true;
  }

  /** Appends the tile and tab to the stage and starts playing if a playlist exists. */
  async start(): Promise<void> {
    const { tracks, version } = await loadTracks();
    if (!tracks.length) return;
    this.tracks = tracks;
    this.version = version;
    try { this.state = JSON.parse(this.storage?.getItem(KEY) ?? "{}") ?? {}; } catch { this.state = {}; }
    this.build();
    this.stage.append(this.tile, this.tab);
    this.tile.hidden = false;
    const placed = this.place(num(this.state.x) ?? this.size.width - 520, num(this.state.y) ?? this.size.height - this.tile.offsetHeight - 220);
    Object.assign(this.state, placed);
    this.setVolume(num(this.state.volume) ?? DEFAULT_VOLUME);
    const saved = this.tracks.findIndex((t) => t.url === this.state.url);
    this.load(saved >= 0 ? saved : 0, saved >= 0 ? num(this.state.time) ?? 0 : 0);
    if (this.state.min === true) this.minimize(true, false);
    if (this.state.on !== false) void this.play();
  }

  toggle(): void {
    if (this.audio.paused) void this.play();
    else { this.audio.pause(); this.save({ on: false }); }
  }

  get visible(): boolean {
    return !this.tile.hidden;
  }

  private build(): void {
    this.tile.setAttribute("aria-label", "Now playing");
    const min = iconButton("music-min", "Minimize to the side", ICON.min);
    const art = el("div", "music-art");
    const img = el("img");
    img.alt = "";
    const eq = () => { const e = el("span", "music-eq"); e.append(el("i"), el("i"), el("i"), el("i")); return e; };
    const startButton = el("button", "music-start", "CLICK TO PLAY");
    startButton.type = "button";
    art.append(img, eq(), startButton);
    const meta = el("div", "music-meta");
    meta.append(el("b", "music-title", "—"), el("span", "music-artist", "LOFI TOKYO"));
    const progress = el("div", "music-progress");
    const bar = el("div", "music-bar");
    bar.title = "Seek";
    bar.append(el("i"));
    progress.append(el("span", "music-elapsed", "0:00"), bar, el("span", "music-duration", "0:00"));
    const controls = el("div", "music-controls");
    const prev = iconButton("", "Previous", ICON.prev), play = iconButton("", "Play / pause", ICON.play), next = iconButton("", "Next", ICON.next);
    this.volumeButton.type = "button";
    this.volumeButton.title = "Volume";
    this.volumeButton.setAttribute("aria-expanded", "false");
    controls.append(prev, play, next, this.volumeButton);
    this.steps.hidden = true;
    this.steps.setAttribute("role", "group");
    this.steps.append(...[0, BG_LEVEL, ...Array.from({ length: 10 }, (_, i) => (i + 1) * 10)].map((level) => {
      const step = el("button", level === BG_LEVEL ? "is-bg" : "", level === BG_LEVEL ? "BG" : String(level));
      step.type = "button";
      step.dataset.level = String(level);
      step.title = level === BG_LEVEL ? "Background: 3%" : `${level}%`;
      step.addEventListener("click", () => { this.setVolume(level / 100); this.openSteps(false); });
      return step;
    }));
    this.tile.append(min, art, meta, progress, controls, this.steps, this.audio);
    this.audio.preload = "auto";
    const tabImg = el("img");
    tabImg.alt = "";
    this.tab.type = "button";
    this.tab.append(tabImg, eq(), el("span", "music-tab-label", "NOW PLAYING"));

    min.addEventListener("click", () => this.minimize(true));
    this.tab.addEventListener("click", () => this.minimize(false));
    play.addEventListener("click", () => this.toggle());
    startButton.addEventListener("click", () => void this.play());
    next.addEventListener("click", () => this.step(1));
    prev.addEventListener("click", () => this.step(-1));
    this.volumeButton.addEventListener("click", () => this.openSteps(this.steps.hidden));
    document.addEventListener("pointerdown", (event) => {
      if (!this.steps.hidden && !(event.target as HTMLElement).closest(".music-vol-steps, .music-volume")) this.openSteps(false);
    });
    bar.addEventListener("click", (event) => {
      const rect = bar.getBoundingClientRect();
      if (this.audio.duration) this.audio.currentTime = ((event.clientX - rect.left) / rect.width) * this.audio.duration;
    });
    this.tile.addEventListener("wheel", (event) => { event.preventDefault(); this.setVolume(this.audio.volume - Math.sign(event.deltaY) * 0.05); }, { passive: false });
    this.audio.addEventListener("play", () => { this.tile.classList.add("is-playing"); this.tab.classList.add("is-playing"); this.errors = 0; });
    this.audio.addEventListener("pause", () => { this.tile.classList.remove("is-playing"); this.tab.classList.remove("is-playing"); });
    this.audio.addEventListener("ended", async () => { await this.refreshList(); this.load(this.index + 1); void this.play(); });
    this.audio.addEventListener("error", async () => {
      this.errors += 1;
      if (await this.refreshList()) { this.load(this.index + 1); if (this.state.on !== false) void this.play(); return; }
      if (this.errors < this.tracks.length) setTimeout(() => { this.load(this.index + 1); if (this.state.on !== false) void this.play(); }, 1500);
    });
    let lastSave = 0;
    this.audio.addEventListener("timeupdate", () => {
      const fraction = this.audio.duration ? this.audio.currentTime / this.audio.duration : 0;
      this.tile.querySelector<HTMLElement>(".music-bar i")!.style.width = `${Math.min(100, fraction * 100)}%`;
      this.tile.querySelector(".music-elapsed")!.textContent = clockTime(this.audio.currentTime);
      this.tile.querySelector(".music-duration")!.textContent = clockTime(this.audio.duration);
      if (Date.now() - lastSave > 5000) { lastSave = Date.now(); this.save({ time: Math.floor(this.audio.currentTime) }); }
    });
    if ("mediaSession" in navigator) {
      navigator.mediaSession.setActionHandler("play", () => void this.play());
      navigator.mediaSession.setActionHandler("pause", () => { this.audio.pause(); this.save({ on: false }); });
      navigator.mediaSession.setActionHandler("nexttrack", () => this.step(1));
      navigator.mediaSession.setActionHandler("previoustrack", () => this.step(-1));
    }
    this.bindDrag();
  }

  private save(patch: Saved = {}): void {
    Object.assign(this.state, patch);
    try { this.storage?.setItem(KEY, JSON.stringify(this.state)); } catch { /* optional */ }
  }

  private show(track: Track): void {
    for (const img of [this.tile.querySelector("img")!, this.tab.querySelector("img")!]) {
      img.classList.toggle("is-emblem", !track.cover);
      img.onerror = () => { img.onerror = null; img.classList.add("is-emblem"); img.src = EMBLEM; };
      img.src = track.cover ?? EMBLEM;
    }
    this.tab.title = `Show now playing · ${track.title}`;
    this.tile.querySelector(".music-title")!.textContent = track.title;
    const credits = [...new Set([track.artist, track.album].filter((v): v is string => Boolean(v)).map((v) => v.toUpperCase()))];
    this.tile.querySelector(".music-artist")!.textContent = credits.join(" · ") || "LOFI TOKYO";
    if ("mediaSession" in navigator && typeof MediaMetadata !== "undefined") {
      navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: track.artist ?? "LoFi Tokyo", album: track.album,
        artwork: [{ src: new URL(track.cover ?? EMBLEM, location.href).href }] });
    }
  }

  /* The playlist rotates nightly; between tracks, pick up a new list so removed files are never requested. */
  private async refreshList(): Promise<boolean> {
    const before = this.version;
    const current = this.tracks[this.index]?.url;
    const { tracks, version } = await loadTracks();
    if (!tracks.length || version === before) return false;
    this.tracks = tracks;
    this.version = version;
    const at = tracks.findIndex((t) => t.url === current);
    this.index = at >= 0 ? at : -1; // -1: the next step starts the new list at its first track
    this.errors = 0;
    return true;
  }

  private load(index: number, startAt = 0): void {
    this.index = (index + this.tracks.length) % this.tracks.length;
    const track = this.tracks[this.index]!;
    this.show(track);
    this.audio.src = track.url;
    if (startAt > 0) this.audio.addEventListener("loadedmetadata", () => { if (startAt < this.audio.duration - 2) this.audio.currentTime = startAt; }, { once: true });
    this.save({ url: track.url, time: startAt });
  }

  private async play(): Promise<void> {
    try {
      await this.audio.play();
      this.tile.classList.remove("needs-click");
      this.save({ on: true });
    } catch {
      this.tile.classList.add("needs-click"); // Lively or the browser blocked autoplay until a click
    }
  }

  private step(direction: number): void {
    const wasPlaying = !this.audio.paused || this.state.on !== false;
    if (direction < 0 && this.audio.currentTime > 4) this.audio.currentTime = 0;
    else this.load(this.index + direction);
    if (wasPlaying) void this.play();
  }

  private setVolume(value: number): void {
    this.audio.volume = Math.max(0, Math.min(1, Math.round(value * 100) / 100));
    const percent = Math.round(this.audio.volume * 100);
    this.volumeButton.textContent = percent === BG_LEVEL ? "VOL BG" : `VOL ${percent}`;
    this.steps.querySelectorAll<HTMLElement>("button").forEach((b) => b.classList.toggle("is-current", Number(b.dataset.level) === percent));
    this.save({ volume: this.audio.volume });
  }

  private openSteps(open: boolean): void {
    this.steps.hidden = !open;
    this.volumeButton.setAttribute("aria-expanded", String(open));
    if (open) this.place(this.tile.offsetLeft, this.tile.offsetTop); // keep the taller tile on screen
  }

  private place(x: number, y: number): { x: number; y: number } {
    const maxX = this.size.width - this.tile.offsetWidth - 10, maxY = this.size.height - this.tile.offsetHeight - 10;
    const left = Math.max(10, Math.min(maxX, x)), top = Math.max(10, Math.min(maxY, y));
    this.tile.style.left = `${left}px`;
    this.tile.style.top = `${top}px`;
    return { x: left, y: top };
  }

  /* Minimize into a tab on whichever side edge the tile is nearer, at its height. */
  private minimize(minimized: boolean, save = true): void {
    if (minimized) {
      const left = this.tile.offsetLeft + this.tile.offsetWidth / 2 < this.size.width / 2;
      this.tab.classList.toggle("is-left", left);
      this.tab.classList.toggle("is-right", !left);
      this.tab.hidden = false;
      this.tab.style.top = `${Math.max(220, Math.min(this.size.height - this.tab.offsetHeight - 120, this.tile.offsetTop + 40))}px`;
    }
    this.tile.classList.toggle("is-min", minimized);
    this.tab.hidden = !minimized;
    if (save) this.save({ min: minimized });
  }

  private bindDrag(): void {
    let drag: { id: number; scale: number; startX: number; startY: number; left: number; top: number } | null = null;
    this.tile.addEventListener("pointerdown", (event) => {
      if ((event.target as HTMLElement).closest("button, .music-bar")) return;
      const scale = Number(this.stage.style.getPropertyValue("--scale")) || 1;
      drag = { id: event.pointerId, scale, startX: event.clientX, startY: event.clientY, left: this.tile.offsetLeft, top: this.tile.offsetTop };
      this.tile.setPointerCapture?.(event.pointerId);
      this.tile.classList.add("is-dragging");
    });
    this.tile.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      this.place(drag.left + (event.clientX - drag.startX) / drag.scale, drag.top + (event.clientY - drag.startY) / drag.scale);
    });
    const end = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      drag = null;
      this.tile.classList.remove("is-dragging");
      this.save({ x: this.tile.offsetLeft, y: this.tile.offsetTop });
    };
    this.tile.addEventListener("pointerup", end);
    this.tile.addEventListener("pointercancel", end);
  }
}
