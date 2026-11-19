import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OfficeWorkLight } from "../src/core/work-light";
import { Chrome } from "../src/core/chrome";
import { Console } from "../src/core/console";
import type { Layout, RunMode } from "../src/core/types";
import command57 from "../layouts/command-57.json";
import command1080 from "../layouts/command-1080.json";

const CANONICAL = "http://192.168.4.115:3098/command-57.html";
const UUID = "d99b6af1-4f3e-422f-aa47-6455bcb49c94";
const OTHER = "4ef69aac-1935-4a64-adf1-747ac1631680";
const START = Date.parse("2026-11-18T18:00:00Z");
const controls: OfficeWorkLight[] = [];
const chromes: Chrome[] = [];
const consoles: Console[] = [];
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

interface Call {
  url: string;
  options: RequestInit;
  method: string;
  settled: boolean;
  aborted: boolean;
  reply(body: unknown, code?: number): void;
  badJson(code?: number): void;
  fail(): void;
}

function harness(mode: RunMode = "live", url = CANONICAL) {
  vi.stubGlobal("location", new URL(url));
  const calls: Call[] = [];
  const fetcher = vi.fn((input: RequestInfo | URL, options: RequestInit = {}) => new Promise<Response>((resolve, reject) => {
    const call: Call = {
      url: String(input), options, method: options.method || "GET", settled: false, aborted: false,
      reply(body, code = 200) {
        expect(call.settled).toBe(false);
        call.settled = true;
        resolve({ status: code, ok: code >= 200 && code < 300, json: async () => body } as Response);
      },
      badJson(code = 200) {
        call.settled = true;
        resolve({ status: code, ok: true, json: async () => { throw new Error("bad JSON"); } } as unknown as Response);
      },
      fail() { call.settled = true; reject(new Error("network unavailable")); },
    };
    options.signal?.addEventListener("abort", () => {
      if (!call.settled) { call.settled = true; call.aborted = true; reject(new Error("AbortError")); }
    });
    calls.push(call);
  }));
  vi.stubGlobal("fetch", fetcher);
  const control = new OfficeWorkLight(mode);
  controls.push(control);
  document.body.append(control.element, control.status);
  control.start();
  const text = () => control.element.querySelector(".work-light-mode")!.textContent;
  const find = (method: string) => calls.find(call => call.method === method && !call.settled);
  const status = (enabled: unknown = false, applied: unknown = true, requestId: unknown = null, offset = 0) => ({
    lighting: {
      available: true, schema_version: 1, updated_at: new Date(Date.now() + offset).toISOString(),
      work_light: { available: true, enabled, applied, request_id: requestId },
    },
  });
  const tick = async (ms: number) => { await vi.advanceTimersByTimeAsync(ms); await flush(); };
  const feed = async (body: unknown = status(), code = 200) => {
    const call = find("GET"); expect(call, "Expected pending status GET").toBeDefined();
    call!.reply(body, code); await flush();
  };
  const ready = async (enabled = false, applied = true) => { await flush(); await feed(status(enabled, applied)); };
  const click = async () => { control.element.click(); await flush(); };
  const ack = async (enabled: unknown, id = UUID, code = 202, extra: Record<string, unknown> = {}) => {
    const call = find("POST"); expect(call, "Expected pending command POST").toBeDefined();
    call!.reply({ accepted: true, enabled, request_id: id, ...extra }, code); await flush();
  };
  return { control, calls, fetcher, text, find, status, tick, feed, ready, click, ack };
}

describe("Office work light", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(START); document.body.innerHTML = ""; });
  afterEach(() => {
    consoles.splice(0).forEach(console_ => console_.stop());
    chromes.splice(0).forEach(chrome => chrome.stop());
    controls.splice(0).forEach(control => control.destroy());
    vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
  });

  it("never uses the network in demo mode, on another origin, or when a demo query is present", async () => {
    for (const [mode, url] of [
      ["demo", CANONICAL],
      ["live", "file:///C:/preview/command-57.html?runtime=live"],
      ["live", "https://192.168.4.115:3098/?runtime=live"],
      ["live", "http://192.168.4.115:8080/?runtime=live"],
      ["live", "http://evil.example:3098/?runtime=live"],
      ["live", "http://rackmain1:3098/?runtime=live"],
      ["live", "http://rackmain1.local:3098/?runtime=live"],
      ["live", "http://127.0.0.1:3098/?runtime=live"],
      ["live", `${CANONICAL}?demo`],
      ["live", `${CANONICAL}?demo=0&runtime=live`],
      ["live", `${CANONICAL}?demo=false`],
    ] as [RunMode, string][]) {
      const h = harness(mode, url); await h.click(); await h.tick(30000);
      expect(h.calls, url).toHaveLength(0); expect(h.control.element.disabled).toBe(true);
      h.control.destroy();
    }
    const live = harness("live", `${CANONICAL}?runtime=live`); await flush();
    expect(live.calls.map(call => call.url)).toEqual(["/office-ai/status"]);
  });

  it("polls fixed JSON status with one four-second bounded request and a five-second idle interval", async () => {
    const h = harness();
    expect(h.control.element.disabled).toBe(true);
    await h.tick(3999); expect(h.calls).toHaveLength(1);
    await h.tick(1); expect(h.calls[0]!.aborted).toBe(true);
    await h.tick(5000); await h.feed();
    expect(h.text()).toBe("AUTO"); expect(h.control.element.disabled).toBe(false);
    const count = h.calls.length;
    await h.tick(4999); expect(h.calls).toHaveLength(count);
    await h.tick(1); expect(h.calls).toHaveLength(count + 1);
    expect(h.calls.every(call => call.url === "/office-ai/status" && call.method === "GET")).toBe(true);
    expect(h.calls[0]!.options).toMatchObject({ credentials: "same-origin", cache: "no-store" });
  });

  it("disables unknown, unavailable, malformed and expired telemetry, and marks unapplied mode", async () => {
    const h = harness(); await flush();
    const invalid = [
      () => null, () => ({}), () => h.status("false"),
      () => h.status(false, true, null, -20001), () => h.status(false, true, null, 15001),
      () => ({ lighting: { ...h.status().lighting, available: false } }),
      () => ({ lighting: { ...h.status().lighting, schema_version: 2 } }),
      () => ({ lighting: { ...h.status().lighting, work_light: { available: false, enabled: false } } }),
    ];
    for (const raw of invalid) {
      await h.feed(raw()); expect(h.control.element.disabled).toBe(true);
      await h.click(); expect(h.calls.some(call => call.method === "POST")).toBe(false);
      await h.tick(5000);
    }
    await h.feed(h.status(true, false));
    expect(h.text()).toBe("WORK*"); expect(h.control.element.getAttribute("aria-label")).toMatch(/not confirmed|unconfirmed/i);
    await h.tick(5000); await h.feed(h.status(false, true, null, -19000));
    await h.tick(1000); expect(h.control.element.disabled).toBe(false);
    await h.tick(1); expect(h.control.element.disabled).toBe(true);
  });

  it("waits for matching applied telemetry before confirming Work and Auto", async () => {
    const h = harness(); await h.ready(); await h.click();
    const post = h.find("POST")!;
    expect(post.url).toBe("/office-ai/work-light");
    expect(JSON.parse(post.options.body as string)).toEqual({ enabled: true });
    expect(post.options).toMatchObject({ credentials: "same-origin", headers: { "Content-Type": "application/json", "X-Office-Control": "work-light" } });
    expect(h.text()).toBe("…"); expect(h.control.element.disabled).toBe(true);
    expect(h.control.element.getAttribute("aria-checked")).toBe("false");
    await h.click(); expect(h.calls.filter(call => call.method === "POST")).toHaveLength(1);
    await h.ack(true); expect(h.control.element.disabled).toBe(true); expect(h.find("GET")).toBeDefined();
    await h.feed(h.status(true, true, OTHER)); expect(h.control.element.disabled).toBe(true);
    await h.tick(1000); await h.feed(h.status(true, false, UUID)); expect(h.control.element.disabled).toBe(true);
    await h.tick(1000); await h.feed(h.status(false, true, UUID)); expect(h.control.element.disabled).toBe(true);
    await h.tick(1000); await h.feed(h.status(true, true, UUID));
    expect(h.text()).toBe("WORK"); expect(h.control.element.disabled).toBe(false);
    expect(h.control.element.getAttribute("aria-checked")).toBe("true");
    await h.click(); expect(JSON.parse(h.find("POST")!.options.body as string)).toEqual({ enabled: false });
    await h.ack(false, OTHER); await h.feed(h.status(false, true, OTHER));
    expect(h.text()).toBe("AUTO"); expect(h.control.element.disabled).toBe(false);
  });

  it("rejects wrong HTTP status, malformed ACKs and noncanonical UUIDv4 identifiers", async () => {
    for (const [id, code, extra] of [
      [UUID, 200, {}], [UUID.toUpperCase(), 202, {}],
      ["d99b6af1-4f3e-122f-aa47-6455bcb49c94", 202, {}],
      ["d99b6af1-4f3e-422f-7a47-6455bcb49c94", 202, {}],
      [UUID, 202, { accepted: false }], [UUID, 202, { enabled: false }], [UUID, 202, { enabled: "true" }],
      [UUID, 429, {}], [UUID, 409, {}], [UUID, 503, {}],
    ] as [string, number, Record<string, unknown>][]) {
      const h = harness(); await h.ready(); await h.click(); await h.ack(true, id, code, extra);
      expect(h.text()).toBe("!"); expect(h.control.status.textContent).not.toBe("");
      expect(h.control.status.getAttribute("aria-live")).toBe("polite");
      expect(h.calls.filter(call => call.method === "POST")).toHaveLength(1);
      h.control.destroy();
    }
  });

  it("shows network, JSON, command timeout and confirmation timeout failures without retrying writes", async () => {
    const network = harness(); await network.ready(); await network.click(); network.find("POST")!.fail(); await flush();
    expect(network.text()).toBe("!"); network.control.destroy();
    const malformed = harness(); await malformed.ready(); await malformed.click(); malformed.find("POST")!.badJson(202); await flush();
    expect(malformed.text()).toBe("!"); malformed.control.destroy();
    const timeout = harness(); await timeout.ready(); await timeout.click(); await timeout.tick(8000);
    expect(timeout.calls.find(call => call.method === "POST")!.aborted).toBe(true); expect(timeout.text()).toBe("!");
    await timeout.tick(30000); expect(timeout.calls.filter(call => call.method === "POST")).toHaveLength(1); timeout.control.destroy();
    const unconfirmed = harness(); await unconfirmed.ready(); await unconfirmed.click(); await unconfirmed.ack(true);
    for (let i = 0; i < 19; i++) { if (unconfirmed.find("GET")) await unconfirmed.feed(unconfirmed.status(true, true, OTHER)); await unconfirmed.tick(1000); }
    expect(unconfirmed.text()).toBe("…"); await unconfirmed.tick(1000); expect(unconfirmed.text()).toBe("!");
  });

  it("defers the post-command refresh until an in-flight GET completes", async () => {
    const h = harness(); await h.ready(); await h.tick(5000); await h.click(); await h.ack(true);
    expect(h.calls.filter(call => call.method === "GET" && !call.settled)).toHaveLength(1);
    await h.feed(h.status()); await h.tick(0); expect(h.find("GET")).toBeDefined();
    expect(h.calls.filter(call => call.method === "GET" && !call.settled)).toHaveLength(1);
    await h.feed(h.status(true, true, UUID)); expect(h.text()).toBe("WORK");
  });

  it("suspends on pagehide, resumes once from BFCache, and stops permanently until explicitly started", async () => {
    const h = harness(); await h.ready(); await h.click();
    window.dispatchEvent(new Event("pagehide")); await flush();
    expect(h.calls.filter(call => !call.settled)).toHaveLength(0); expect(vi.getTimerCount()).toBe(0);
    const count = h.calls.length; await h.tick(30000); expect(h.calls).toHaveLength(count);
    window.dispatchEvent(new Event("pageshow")); await flush(); expect(h.calls).toHaveLength(count + 1);
    await h.feed(); expect(h.control.element.disabled).toBe(false);
    window.dispatchEvent(new Event("pageshow")); await flush(); expect(h.calls).toHaveLength(count + 1);
    h.control.stop(); await flush(); expect(vi.getTimerCount()).toBe(0);
    const stopped = h.calls.length;
    window.dispatchEvent(new Event("pageshow")); await h.tick(30000); expect(h.calls).toHaveLength(stopped);
    h.control.start(); await flush(); expect(h.calls).toHaveLength(stopped + 1);
    h.control.destroy(); await flush(); expect(vi.getTimerCount()).toBe(0);
    h.control.start(); window.dispatchEvent(new Event("pageshow")); await h.tick(30000); expect(h.calls).toHaveLength(stopped + 1);
    expect(h.calls.every(call => call.url === "/office-ai/status" || call.url === "/office-ai/work-light")).toBe(true);
  });

  function mountChrome(layout: Layout, mode: RunMode) {
    const root = document.createElement("div"), stage = document.createElement("div");
    document.body.append(root); root.append(stage);
    const chrome = new Chrome({
      layout, root, stage, mode, storage: null, refresh: vi.fn(), openDetail: vi.fn(),
      closeDetail: vi.fn(), setRegionColumns: vi.fn(), showRegion: vi.fn(),
    });
    chromes.push(chrome);
    const toggles = chrome.toggles(); stage.append(toggles); chrome.start();
    return { chrome, toggles };
  }

  it("adds a disabled, network-free demo light beside privacy only on the two Command layouts", async () => {
    vi.stubGlobal("location", new URL(CANONICAL));
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    for (const base of [command57, command1080]) {
      const layout = { ...structuredClone(base), nightMode: false } as unknown as Layout;
      const { chrome, toggles } = mountChrome(layout, "demo");
      const light = toggles.querySelector<HTMLButtonElement>(".work-light-toggle")!;
      expect(light).not.toBeNull(); expect(light.disabled).toBe(true); expect(light.type).toBe("button");
      expect(toggles.querySelector(".privacy-toggle")!.nextElementSibling).toBe(light);
      expect(toggles.querySelector(".work-light-status")!.getAttribute("aria-live")).toBe("polite");
      light.click(); await vi.advanceTimersByTimeAsync(10000); expect(fetcher).not.toHaveBeenCalled();
      chrome.stop();
    }
    const otherDock = { ...structuredClone(command57), id: "unrelated-dock", nightMode: false } as unknown as Layout;
    const other = mountChrome(otherDock, "live");
    expect(other.toggles.querySelector(".privacy-toggle")).not.toBeNull();
    expect(other.toggles.querySelector(".work-light-toggle")).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("Chrome.stop aborts live lighting and pageshow cannot revive its polling", async () => {
    vi.stubGlobal("location", new URL(CANONICAL));
    let secondSignal: AbortSignal | null | undefined;
    const fetcher = vi.fn((_url: RequestInfo | URL, options: RequestInit = {}) => {
      if (fetcher.mock.calls.length === 1) return Promise.resolve({ status: 200, json: async () => ({ lighting: {
        available: true, schema_version: 1, updated_at: new Date(Date.now()).toISOString(),
        work_light: { available: true, enabled: false, applied: true, request_id: null },
      } }) } as Response);
      secondSignal = options.signal;
      return new Promise<Response>((_resolve, reject) => options.signal?.addEventListener("abort", () => reject(new Error("AbortError"))));
    });
    vi.stubGlobal("fetch", fetcher);
    const layout = { ...structuredClone(command57), nightMode: false } as unknown as Layout;
    const { chrome, toggles } = mountChrome(layout, "live"); await flush();
    expect(toggles.querySelector(".work-light-mode")!.textContent).toBe("AUTO");
    await vi.advanceTimersByTimeAsync(5000); expect(fetcher).toHaveBeenCalledTimes(2);
    chrome.stop(); await flush(); expect(secondSignal?.aborted).toBe(true);
    expect(toggles.querySelector<HTMLButtonElement>(".work-light-toggle")!.disabled).toBe(true);
    window.dispatchEvent(new Event("pageshow")); await vi.advanceTimersByTimeAsync(30000);
    expect(fetcher).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });

  it("Console.stop forwards cleanup to its mounted demo light", async () => {
    vi.stubGlobal("location", new URL(CANONICAL));
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const stop = vi.spyOn(OfficeWorkLight.prototype, "stop");
    const layout = { ...structuredClone(command57), music: false, nightMode: false } as unknown as Layout;
    layout.regions.forEach(region => { region.panels = []; });
    const root = document.createElement("div"); document.body.append(root);
    const console_ = new Console({ layout, root, mode: "demo", storage: null }).mount(); consoles.push(console_);
    const light = root.querySelector<HTMLButtonElement>(".work-light-toggle")!;
    expect(light).not.toBeNull(); expect(light.disabled).toBe(true); expect(fetcher).not.toHaveBeenCalled();
    console_.stop(); expect(stop).toHaveBeenCalledOnce();
    window.dispatchEvent(new Event("pageshow")); await flush(); expect(fetcher).not.toHaveBeenCalled();
  });
});
