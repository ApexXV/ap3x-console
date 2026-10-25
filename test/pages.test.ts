import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Console } from "../src/core/console";
import { validateLayout } from "../src/core/layout";
import { getModule } from "../src/core/registry";
import type { Layout } from "../src/core/types";
import { registerBuiltins } from "../src/modules";

registerBuiltins();
const known = (id: string) => Boolean(getModule(id));

const pagesLayout = (): Layout => ({
  id: "pages-test",
  title: "PAGES",
  stage: { width: 800, height: 480, fontSize: 16 },
  regionColumns: "minmax(0, 1fr)",
  navigation: "pages",
  chrome: "compact",
  homeAfterSeconds: 60,
  regions: ["home", "printers", "network"].map((id) => ({
    id, title: id.toUpperCase(), columns: "minmax(0, 1fr)", rows: "minmax(0, 1fr)",
    panels: [{ id: `${id}-panel`, module: "placeholder", settings: { name: id } }],
  })),
});

describe("pages navigation", () => {
  beforeEach(() => { vi.useFakeTimers(); document.body.innerHTML = '<div id="app"></div>'; });
  afterEach(() => { vi.useRealTimers(); });

  it("validates the new layout fields", () => {
    expect(validateLayout(pagesLayout(), known)).toEqual([]);
    const bad = { ...pagesLayout(), navigation: "tabs", chrome: "tiny", homeAfterSeconds: 5 };
    const problems = validateLayout(bad, known);
    expect(problems.some((p) => p.startsWith("navigation"))).toBe(true);
    expect(problems.some((p) => p.startsWith("chrome"))).toBe(true);
    expect(problems.some((p) => p.startsWith("homeAfterSeconds"))).toBe(true);
    expect(validateLayout({ ...pagesLayout(), navigation: "columns" }, known).some((p) => p.startsWith("homeAfterSeconds"))).toBe(true);
  });

  it("shows one region at a time with a tab per region", () => {
    const root = document.getElementById("app")!;
    const console_ = new Console({ layout: pagesLayout(), root, mode: "demo", storage: null }).mount();
    const regions = [...root.querySelectorAll<HTMLElement>(".region")];
    const tabs = [...root.querySelectorAll<HTMLButtonElement>(".page-tab")];
    expect(root.dataset.navigation).toBe("pages");
    expect(root.dataset.chrome).toBe("compact");
    expect(tabs.map((t) => t.textContent)).toEqual(["HOME", "PRINTERS", "NETWORK"]);
    expect(regions.map((r) => r.hidden)).toEqual([false, true, true]);
    tabs[2]!.click();
    expect(console_.currentPage).toBe(2);
    expect(regions.map((r) => r.hidden)).toEqual([true, true, false]);
    expect(tabs[2]!.classList.contains("is-active")).toBe(true);
    console_.showPage(-1);
    expect(console_.currentPage).toBe(2);
  });

  it("returns to the first page after the idle time, and a touch restarts the countdown", () => {
    const root = document.getElementById("app")!;
    const console_ = new Console({ layout: pagesLayout(), root, mode: "demo", storage: null }).mount();
    console_.showPage(1);
    vi.advanceTimersByTime(45_000);
    root.dispatchEvent(new Event("pointerdown"));
    vi.advanceTimersByTime(45_000);
    expect(console_.currentPage).toBe(1);
    vi.advanceTimersByTime(16_000);
    expect(console_.currentPage).toBe(0);
    console_.stop();
  });

  it("column layouts are unchanged", () => {
    const root = document.getElementById("app")!;
    const layout = { ...pagesLayout(), navigation: undefined, chrome: undefined, homeAfterSeconds: undefined };
    new Console({ layout, root, mode: "demo", storage: null }).mount();
    expect(root.querySelector(".page-nav")).toBeNull();
    expect([...root.querySelectorAll<HTMLElement>(".region")].every((r) => !r.hidden)).toBe(true);
  });
});

describe("clock format", () => {
  it("a layout can switch every time to 12-hour; 24-hour stays the default", async () => {
    const { clockOf, clockWithSeconds, setClockFormat } = await import("../src/core/format");
    const stamp = "2026-10-25T22:07:33Z"; // 6:07 PM in New York
    document.body.innerHTML = '<div id="app"></div>';
    new Console({ layout: { ...pagesLayout(), clock: "12h" }, root: document.getElementById("app")!, mode: "demo", storage: null }).mount();
    expect(clockOf(stamp)).toBe("6:07 PM");
    expect(clockWithSeconds(stamp)).toBe("6:07:33 PM");
    new Console({ layout: pagesLayout(), root: document.getElementById("app")!, mode: "demo", storage: null }).mount();
    expect(clockOf(stamp)).toBe("18:07");
    expect(clockWithSeconds(stamp)).toBe("18:07:33");
    expect(validateLayout({ ...pagesLayout(), clock: "13h" }, known)).toContain('clock must be "12h" or "24h"');
    setClockFormat("24h");
  });
});
