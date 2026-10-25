import { button, el } from "../../core/dom";
import { note } from "../../core/detail";
import { clockWithSeconds } from "../../core/format";
import type { ModuleManifest, RunMode } from "../../core/types";
import "./camera.css";

/* A still-frame camera: the frame URL (e.g. go2rtc's /api/frame.jpeg) is reloaded on its own
 * short cycle, independent of the console refresh, with a scan sweep on each new frame.
 * Only the image loads; credentials stay in go2rtc's config on the host. */

export interface CameraModel { url: string; mode: RunMode; everyMs: number; label: string; streamUrl: string | null; liveMinutes: number }

const state = new WeakMap<HTMLElement, { timer: ReturnType<typeof setInterval>; lastGood: number; url: string }>();
/** Last good frame per URL, so the chip the console redraws each refresh reflects the frame loop. */
const lastFrame = new Map<string, { good: number; failed: boolean }>();
const RETAIN_MS = 45_000;

function attach(body: HTMLElement, m: CameraModel, chipHost: () => HTMLElement | null): void {
  const existing = state.get(body);
  if (existing && existing.url === m.url) return;
  if (existing) clearInterval(existing.timer);
  const frame = el("div", "cam-frame");
  const img = el("img");
  img.alt = `${m.label} camera frame`;
  const scan = el("span", "cam-scan");
  const stamp = el("span", "cam-stamp", "--:--:--");
  const empty = el("div", "cam-empty", m.mode === "demo" ? "DEMO · LIVE FRAMES ON THE HOST ONLY" : "WAITING FOR A FRAME");
  frame.append(img, scan, stamp, empty);
  body.replaceChildren(frame);
  const entry = { timer: setInterval(() => load(), m.everyMs), lastGood: 0, url: m.url };
  state.set(body, entry);
  const setChip = (label: string, tone: string) => {
    const chip = chipHost();
    if (chip) { chip.textContent = label; chip.dataset.tone = tone; }
  };
  img.onload = () => {
    entry.lastGood = Date.now();
    lastFrame.set(m.url, { good: entry.lastGood, failed: false });
    img.classList.add("is-live");
    empty.hidden = true;
    stamp.textContent = clockWithSeconds(new Date().toISOString());
    scan.classList.remove("run"); void scan.offsetWidth; scan.classList.add("run");
    setChip("LIVE", "good");
  };
  img.onerror = () => {
    const retained = Date.now() - entry.lastGood <= RETAIN_MS;
    lastFrame.set(m.url, { good: entry.lastGood, failed: true });
    img.classList.toggle("is-live", retained);
    empty.hidden = retained;
    setChip(retained ? "RETAINED" : "FRAME OFFLINE", retained ? "warn" : "bad");
  };
  const load = () => {
    // Skip while the panel is hidden (another page of a paged layout); the next tick catches up.
    if (m.mode === "demo" || !body.isConnected || body.offsetParent === null) return;
    img.src = `${m.url}${m.url.includes("?") ? "&" : "?"}v=${Date.now()}`;
  };
  load();
}

/* Live video: go2rtc's own player page in a full-screen layer outside the console's detail view,
 * so console refreshes don't restart the stream. It closes on CLOSE or after `liveMinutes`. */
let live: { layer: HTMLElement; timer: ReturnType<typeof setTimeout> } | null = null;

export function closeLive(): void {
  if (!live) return;
  clearTimeout(live.timer);
  live.layer.remove();
  live = null;
}

export function openLive(m: CameraModel, host: HTMLElement = document.body): void {
  if (!m.streamUrl) return;
  closeLive();
  const layer = el("div", "cam-live");
  const bar = el("div", "cam-live-bar");
  bar.append(el("b", "", `${m.label.toUpperCase()} · LIVE`), el("span", "", `closes after ${m.liveMinutes} min`), button("CLOSE", "Close the live view", closeLive, "btn cam-live-close"));
  const frame = el("iframe");
  frame.src = m.streamUrl;
  frame.title = `${m.label} live video`;
  frame.allow = "autoplay; fullscreen";
  layer.append(bar, frame);
  host.append(layer);
  live = { layer, timer: setTimeout(closeLive, m.liveMinutes * 60_000) };
}

export const cameraModule: ModuleManifest<CameraModel, { url: string; refreshSeconds: number; label: string; streamUrl: string; liveMinutes: number }> = {
  id: "camera",
  title: "CAMERA",
  description: "A camera still frame refreshed every few seconds from a frame URL such as go2rtc's frame.jpeg.",
  version: "1.0.0",
  defaults: { url: "/go2rtc/api/frame.jpeg?src=office_cam_wall", refreshSeconds: 5, label: "Camera", streamUrl: "", liveMinutes: 10 },
  sources: [],

  model: (ctx) => ({
    url: ctx.settings.url, mode: ctx.mode, everyMs: Math.max(2, ctx.settings.refreshSeconds) * 1000, label: ctx.settings.label,
    streamUrl: ctx.settings.streamUrl || null, liveMinutes: Math.min(60, Math.max(1, ctx.settings.liveMinutes || 10)),
  }),

  render(body, m) {
    attach(body, m, () => body.closest(".panel")?.querySelector<HTMLElement>(":scope > header .chip") ?? null);
  },

  chip(m) {
    if (m.mode === "demo") return { label: "DEMO · NO FEED", tone: "info" };
    const last = lastFrame.get(m.url);
    if (!last) return { label: "WAIT", tone: "muted" };
    if (!last.failed) return { label: "LIVE", tone: "good" };
    return Date.now() - last.good <= RETAIN_MS ? { label: "RETAINED", tone: "warn" } : { label: "FRAME OFFLINE", tone: "bad" };
  },

  detail(m) {
    const frame = el("div", "cam-frame is-large");
    const img = el("img", m.mode === "demo" ? "" : "is-live");
    img.alt = `${m.label} camera frame`;
    if (m.mode !== "demo") img.src = `${m.url}${m.url.includes("?") ? "&" : "?"}v=${Date.now()}`;
    frame.append(img);
    const sections = [m.mode === "demo" ? note("Live frames are shown on the host only.") : frame];
    if (m.streamUrl && m.mode === "live") sections.push(button("▶ WATCH LIVE", "Open the live video stream", () => openLive(m), "btn cam-watch"));
    return {
      title: m.label.toUpperCase(), foot: "Still frames and live video come from the host's camera relay; nothing is recorded by the console",
      columns: "minmax(0, 1fr)", rows: m.streamUrl && m.mode === "live" ? "minmax(0, 1fr) auto" : "minmax(0, 1fr)",
      sections,
    };
  },
};
