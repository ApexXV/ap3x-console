import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import command57 from "../layouts/command-57.json";
import { nextBoundary, scheduledNight } from "../src/core/chrome";
import { Console } from "../src/core/console";
import { validateLayout } from "../src/core/layout";
import { loadTracks } from "../src/core/music";
import { getModule } from "../src/core/registry";
import { sortTicker } from "../src/core/ticker";
import type { Layout } from "../src/core/types";
import { registerBuiltins } from "../src/modules";

registerBuiltins();
const known = (id: string) => Boolean(getModule(id));
const layout = () => structuredClone(command57) as unknown as Layout;
const key = (k: string) => document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));

describe("wall chrome layout fields", () => {
  it("rejects bad focus, links and flags", () => {
    const bad = layout() as unknown as Record<string, any>;
    bad.focus = { ops: "1fr; background: red", nowhere: "1fr 1fr 1fr" };
    bad.links = [{ label: "X", title: "X", href: "https://example.com" }, { label: "Y", title: "Y", href: "/y.html", key: "yy" }, { label: "Z", title: "Z", href: "//evil.example/z.html" }];
    bad.ticker = "yes";
    const problems = validateLayout(bad, known);
    expect(problems.some((p) => p.startsWith("focus.ops"))).toBe(true);
    expect(problems.some((p) => p.includes("nowhere"))).toBe(true);
    expect(problems.some((p) => p.startsWith("links[0]"))).toBe(true);
    expect(problems.some((p) => p.startsWith("links[1]"))).toBe(true);
    expect(problems.some((p) => p.startsWith("links[2]"))).toBe(true);
    expect(problems.some((p) => p.startsWith("ticker"))).toBe(true);
  });
});

describe("ticker order", () => {
  it("puts today / tonight first, then by order, keeping ties stable", () => {
    const sorted = sortTicker([
      { label: "WEATHER", value: "", order: 50 }, { label: "A", value: "" }, { label: "BANK", value: "", order: 10 },
      { label: "FINISHING", value: "", hot: true, order: 3 }, { label: "TONIGHT", value: "", hot: true, order: 1 }, { label: "B", value: "" },
    ]);
    expect(sorted.map((i) => i.label)).toEqual(["TONIGHT", "FINISHING", "BANK", "WEATHER", "A", "B"]);
  });
});

describe("night schedule", () => {
  it("is night from 22:00 to 08:00 Eastern", () => {
    expect(scheduledNight(Date.parse("2026-10-26T02:30:00Z"))).toBe(true); // 22:30 EDT
    expect(scheduledNight(Date.parse("2026-10-26T13:00:00Z"))).toBe(false); // 09:00 EDT
    expect(new Date(nextBoundary(Date.parse("2026-10-26T13:00:00Z"))).toISOString()).toBe("2026-10-27T02:00:00.000Z");
  });
});

describe("wall chrome on command-57", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] }); document.body.innerHTML = '<div id="app"></div>'; });
  afterEach(() => { vi.useRealTimers(); });

  it("builds the dock, ticker, toggles and drawer, and answers the wall's keys", async () => {
    const root = document.getElementById("app")!;
    const columns: string[] = [];
    const console_ = new Console({ layout: layout(), root, mode: "demo", storage: null }).mount();
    const regions = root.querySelector<HTMLElement>(".regions")!;
    await console_.refresh();
    expect([...root.querySelectorAll(".dock [data-focus-set]")].map((b) => b.textContent)).toEqual(["OPS", "BUSINESS", "MARKETS", "BALANCED"]);
    expect(root.querySelectorAll(".dock-row")[1]!.textContent).toContain("LOCAL OPS");
    expect(root.querySelector(".night-toggle")).not.toBeNull();
    expect(root.querySelector(".privacy-toggle")).not.toBeNull();
    expect(root.querySelector(".drawer")).not.toBeNull();

    key("2"); columns.push(regions.style.gridTemplateColumns);
    expect(root.dataset.focus).toBe("business");
    key("0"); columns.push(regions.style.gridTemplateColumns);
    expect(columns).toEqual(["4fr 11fr 4fr", "5fr 8fr 5fr"]);

    key("p");
    expect(root.dataset.privacy).toBe("on");
    key("p");
    expect(root.dataset.privacy).toBe("off");
    const motion = root.dataset.motion;
    key("m");
    expect(root.dataset.motion).not.toBe(motion);

    const track = root.querySelector(".ticker-track")!;
    const labels = [...track.querySelectorAll(":scope > span > b")].map((b) => b.textContent);
    expect(labels.length % 2).toBe(0);
    for (const label of ["BANK 30D", "RECEIVED 2026", "BOOKS", "FM OPS", "WEATHER"]) expect(labels).toContain(label);
    expect([...track.querySelectorAll("[data-private]")].length).toBeGreaterThanOrEqual(4); // bank + receipts, twice
    const firstCold = labels.findIndex((_, i) => !track.children[i]!.classList.contains("is-tonight"));
    expect(labels.slice(firstCold, labels.length / 2).some((_, i) => track.children[firstCold + i]!.classList.contains("is-tonight"))).toBe(false);

    key("s");
    expect(root.querySelector(".detail")?.textContent ?? root.textContent).toContain("/api/wall/business-banking");
  });
});

describe("music playlist", () => {
  const response = (body: unknown, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);

  it("uses the detailed LoFi list and drops anything outside /music/", async () => {
    const fetcher = vi.fn((url: string) => response(url.includes("tracks.json")
      ? { generated_at: "v1", album: "LoFi Tokyo", tracks: [{ url: "/music/a.mp3", title: "One" }, { url: "https://evil.example/b.mp3" }] }
      : null, url.includes("tracks.json"))) as unknown as typeof fetch;
    const { tracks, version } = await loadTracks(fetcher);
    expect(version).toBe("v1");
    expect(tracks.map((t) => [t.url, t.title, t.album])).toEqual([["/music/a.mp3", "One", "LoFi Tokyo"]]);
  });

  it("falls back to the plain wall playlist", async () => {
    const fetcher = vi.fn((url: string) => (url.includes("tracks.json") ? response(null, false) : response(["/music/01-late_night.mp3", "/etc/x"]))) as unknown as typeof fetch;
    const { tracks } = await loadTracks(fetcher);
    expect(tracks.map((t) => t.title)).toEqual(["late night"]);
  });
});
