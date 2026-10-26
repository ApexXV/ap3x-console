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
    bad.logo = "//evil.example/logo.png";
    const problems = validateLayout(bad, known);
    expect(problems.some((p) => p.startsWith("focus.ops"))).toBe(true);
    expect(problems.some((p) => p.includes("nowhere"))).toBe(true);
    expect(problems.some((p) => p.startsWith("links[0]"))).toBe(true);
    expect(problems.some((p) => p.startsWith("links[1]"))).toBe(true);
    expect(problems.some((p) => p.startsWith("links[2]"))).toBe(true);
    expect(problems.some((p) => p.startsWith("ticker"))).toBe(true);
    expect(problems.some((p) => p.startsWith("logo"))).toBe(true);
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

describe("tracked business days (shared with the old wall)", () => {
  it("reads the wall's c57-biz-days, adds today, and builds weekly deltas", async () => {
    const { recordBusinessDay, resetTrackedDays, trackedWeeks, BIZ_DAYS_KEY } = await import("../src/modules/business/model");
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } as Storage;
    store.set(BIZ_DAYS_KEY, JSON.stringify({ "2026-10-19": { gross: 1000, receipts: 10, review: 5, open: 3 }, "2026-10-21": { gross: 1500, receipts: 12, review: 4, open: 3 }, junk: 1 }));
    resetTrackedDays();
    const m = {
      mode: "live", now: Date.parse("2026-10-26T16:00:00Z"),
      receipts: { state: "live", grossReceived: 2100, receiptCount: 15 }, review: { state: "live", totalOpen: 2 },
      current: { state: "live" }, obligations: [{}, {}],
    } as unknown as Parameters<typeof recordBusinessDay>[0];
    const days = recordBusinessDay(m, storage);
    expect(Object.keys(days)).toEqual(["2026-10-19", "2026-10-21", "2026-10-26"]);
    expect(JSON.parse(store.get(BIZ_DAYS_KEY)!)["2026-10-26"]).toEqual({ gross: 2100, receipts: 15, review: 2, open: 2 });
    const weeks = trackedWeeks(days);
    expect(weeks.map((w) => [w.start, w.grossAdded, w.receiptsAdded, w.reviewEnd, w.partialStart])).toEqual([
      ["2026-10-19", 500, 2, 4, true], ["2026-10-26", 600, 3, 2, false],
    ]);
    resetTrackedDays();
  });
});

describe("region head chips", () => {
  beforeEach(() => { document.body.innerHTML = '<div id="app"></div>'; });

  it("shows the first chip a named panel offers", async () => {
    const root = document.getElementById("app")!;
    const l = layout();
    l.regions[0]!.chipFrom = ["services", "host"];
    l.regions[1]!.chipFrom = ["bank"];
    l.regions[2]!.chipFrom = ["portfolio"];
    const console_ = new Console({ layout: l, root, mode: "demo", storage: null }).mount();
    await console_.refresh();
    const chip = (id: string) => root.querySelector<HTMLElement>(`[data-region-chip="${id}"]`)!;
    expect(chip("ops").textContent).toBe("1 SERVICE DOWN");
    expect(chip("business").textContent).toBe("DEMO DATA");
    expect(chip("markets").textContent).toMatch(/^\$[\d.]+K$/);
    expect(chip("markets").dataset.private).toBe("");
    expect(validateLayout({ ...l, regions: [{ ...l.regions[0]!, chipFrom: ["portfolio"] }, ...l.regions.slice(1)] }, known).some((p) => p.includes("chipFrom"))).toBe(true);
  });
});

describe("tabs navigation (command-1080)", () => {
  beforeEach(() => { document.body.innerHTML = '<div id="app"></div>'; });

  it("shows one region, switched from the dock and the number keys, business first", async () => {
    const { default: c1080 } = await import("../layouts/command-1080.json");
    const root = document.getElementById("app")!;
    new Console({ layout: structuredClone(c1080) as unknown as Layout, root, mode: "demo", storage: null }).mount();
    const shown = () => [...root.querySelectorAll<HTMLElement>(".region")].filter((r) => !r.hidden).map((r) => r.dataset.region);
    expect(root.dataset.navigation).toBe("tabs");
    expect(root.querySelector(".page-nav")).toBeNull();
    expect(document.documentElement.classList.contains("touch-ui")).toBe(false);
    expect(shown()).toEqual(["business"]);
    expect([...root.querySelectorAll(".dock [data-focus-set]")].map((b) => b.textContent)).toEqual(["OPS", "BUSINESS", "MARKETS"]);
    key("3");
    expect(shown()).toEqual(["markets"]);
    root.querySelector<HTMLButtonElement>('.dock [data-focus-set="ops"]')!.click();
    expect(shown()).toEqual(["ops"]);
    key("0");
    expect(shown()).toEqual(["business"]);
  });

  it("needs the dock", () => {
    const bad = { ...layout(), navigation: "tabs", dock: false } as unknown as Layout;
    expect(validateLayout(bad, known).some((p) => p.includes("tabs"))).toBe(true);
  });
});

describe("layout editor edits", async () => {
  const ed = await import("../src/core/editor");

  it("moves a boundary within limits and formats tracks", () => {
    expect(ed.moveBoundary([100, 100, 100], 0, 30)).toEqual([130, 70, 100]);
    expect(ed.moveBoundary([100, 100, 100], 0, 500)[1]).toBeCloseTo(18); // 6% of 300
    expect(ed.formatTracks([250, 400, 250], 3)).toBe("minmax(0, 0.83fr) minmax(0, 1.33fr) minmax(0, 0.83fr)");
  });

  it("reads and rewrites spans", () => {
    expect(ed.spanOf(undefined, 6)).toBe(1);
    expect(ed.spanOf("span 4", 6)).toBe(4);
    expect(ed.spanOf("1 / -1", 3)).toBe(3);
    expect(ed.spanOf("5 / span 2", 6)).toBe(2);
    expect(ed.withSpan("1 / span 4", 3)).toBe("1 / span 3");
    expect(ed.withSpan("span 2", 1)).toBeUndefined();
    expect(ed.withSpan(undefined, 2)).toBe("span 2");
  });

  it("swaps contents but keeps each spot's size, across regions too", () => {
    const next = ed.swapPanels(layout(), "fm", "portfolio");
    const ops = next.regions[0]!.panels, mk = next.regions[2]!.panels;
    expect(ops[8]).toMatchObject({ id: "portfolio", module: "portfolio", column: "1 / -1" });
    expect(mk[0]).toMatchObject({ id: "fm", module: "clickup" });
    expect(mk[0]!.column).toBeUndefined();
    expect(validateLayout(next, known)).toEqual([]);
  });

  it("adds, removes and resizes panels, and keeps region chips valid", () => {
    let next = ed.addPanel(layout(), "markets", "weather");
    next = ed.addPanel(next, "markets", "weather");
    expect(next.regions[2]!.panels.slice(-2).map((p) => p.id)).toEqual(["weather", "weather-2"]);
    next = ed.removePanel(next, "portfolio");
    expect(next.regions[2]!.chipFrom).toEqual([]);
    next = ed.resizePanel(next, "quotes", 1, 2);
    expect(next.regions[2]!.panels.find((p) => p.id === "quotes")).toMatchObject({ row: "span 2" });
    expect(validateLayout(next, known)).toEqual([]);
  });

  it("saves widths into the current focus preset", () => {
    expect(ed.setRegionWidths(layout(), "balanced", "minmax(0, 1fr) minmax(0, 2fr) minmax(0, 1fr)").regionColumns).toBe("minmax(0, 1fr) minmax(0, 2fr) minmax(0, 1fr)");
    const focused = ed.setRegionWidths(layout(), "ops", "minmax(0, 3fr) minmax(0, 1fr) minmax(0, 1fr)");
    expect(focused.focus!.ops).toBe("minmax(0, 3fr) minmax(0, 1fr) minmax(0, 1fr)");
    expect(focused.regionColumns).toBe("5fr 8fr 5fr");
  });

  it("keeps a saved edit only while it is valid and matches the regions", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } as Storage;
    const base = layout();
    const edited = ed.removePanel(base, "threat");
    ed.saveLayout(edited, base, storage);
    expect(ed.loadSaved(base, storage, known)).toEqual({ layout: edited, baseChanged: false });
    const released = { ...base, title: "COMMAND 57 · NEW" };
    expect(ed.loadSaved(released, storage, known)?.baseChanged).toBe(true);
    store.set(ed.savedKey(base.id), JSON.stringify({ v: 1, base: "x", layout: { ...edited, regions: edited.regions.slice(1) } }));
    expect(ed.loadSaved(base, storage, known)).toBeNull();
    ed.clearSaved(base, storage);
    expect(store.size).toBe(0);
  });
});
