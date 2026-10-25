import { describe, expect, it } from "vitest";
import { SourceHub } from "../src/core/sources";
import { getModule, moduleIds } from "../src/core/registry";
import { registerBuiltins } from "../src/modules";
import type { AnyModule, ModuleContext } from "../src/core/types";
import { parseLab } from "../src/modules/lab";
import { parseSessions, parseYoutube, diskStatus } from "../src/modules/media/parse";
import { parseServices, DEFAULT_SERVICES } from "../src/modules/services";
import { dueText, parseFm } from "../src/modules/fm";
import { parseHost } from "../src/modules/host";
import { parseThreat } from "../src/modules/threat";

registerBuiltins();
const NOW = Date.parse("2026-10-25T18:00:00Z");

function context(module: AnyModule, payloads: Record<string, unknown>, stageWidth = 7680): ModuleContext {
  const hub = new SourceHub(async () => null, () => NOW);
  for (const s of module.sources) hub.register(s);
  return { now: NOW, mode: "demo", settings: { ...(module.defaults ?? {}) }, sources: hub.fromPayloads(payloads), stageWidth };
}

describe.each(moduleIds())("module %s", (id) => {
  const module = getModule(id)!;

  it("renders its demo data, builds its detail view, and survives garbage input", () => {
    for (const payloads of [module.demo?.(NOW) ?? {}, {}, Object.fromEntries(module.sources.map((s) => [s.id, { schema_version: "WRONG", nodes: 5, devices: "x" }]))]) {
      for (const width of [7680, 3200]) {
        const ctx = context(module, payloads, width);
        const model = module.model(ctx);
        const body = document.createElement("div");
        module.render(body, model, ctx);
        expect(body.childNodes.length).toBeGreaterThan(0);
        module.chip?.(model);
        module.priority?.(model);
        module.changes?.(model, model);
        const view = module.detail?.call(module, model, ctx, { rebuild: () => {}, state: {} });
        if (view) expect(view.sections.length).toBeGreaterThan(0);
      }
    }
  });

  it("declares a manifest the console can use", () => {
    expect(module.title).toBeTruthy();
    expect(module.description.length).toBeGreaterThan(20);
    expect(module.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("contracts", () => {
  it("lab: a stale feed and unknown states are handled", () => {
    const lab = parseLab({ schema_version: "AP3X-PRINTERS-1", generated_at: new Date(NOW - 600_000).toISOString(),
      devices: [{ key: "x", name: "X1C", kind: "toaster", state: "melting" }] }, NOW);
    expect(lab.status).toBe("STALE");
    expect(lab.devices[0]).toMatchObject({ kind: "fdm", state: "unknown" });
  });

  it("media: sessions and YouTube parse, and the disk forecast thresholds", () => {
    const demo = getModule("media")!.demo!(NOW) as Record<string, unknown>;
    const sessions = parseSessions(demo["media-sessions"], NOW)!;
    expect(sessions.streams[0]!.decision).toBe("transcode");
    expect(sessions.stuckOverDay).toBe(1);
    const yt = parseYoutube(demo.youtube, NOW)!;
    expect([yt.running, yt.held, yt.todayAdded]).toEqual([1, 1, 3]);
    expect(diskStatus(yt)!.tone).toBe("good");
    expect(diskStatus({ ...yt, daysToFull: 10 })!.tone).toBe("bad");
    expect(diskStatus({ ...yt, daysToFull: 20 })!.tone).toBe("warn");
    expect(parseSessions({ schema_version: "nope" }, NOW)).toBeNull();
  });

  it("feed health: optional feeds appear only once seen, quiet feeds never alert", () => {
    const feeds = getModule("feed-health")!;
    const ctx = context(feeds, {});
    const model = feeds.model(ctx) as { feeds: { id: string }[]; problems: unknown[] };
    expect(model.feeds.some((f) => f.id === "printers")).toBe(false);
    ctx.sources.bank = { id: "bank", status: "down", data: null, ageMs: null, fetchedAt: null, seen: true };
    expect((feeds.model(ctx) as { problems: { id: string }[] }).problems.some((p) => p.id === "bank")).toBe(false);
  });

  it("services: aliases match service or container lists, unknowns stay unknown", () => {
    const m = parseServices([{ containers: [{ container: "linuxserver-sonarr", status: "running" }, { name: "plex", state: "DOWN" }] }, null], DEFAULT_SERVICES);
    expect(m.services.find((s) => s.name === "Sonarr")).toMatchObject({ online: true });
    expect(m.services.find((s) => s.name === "Plex")).toMatchObject({ online: false, state: "DOWN" });
    expect(m.services.find((s) => s.name === "Readarr")).toMatchObject({ online: null, state: "UNKNOWN" });
    expect([m.known, m.online]).toEqual([2, 1]);
  });

  it("host: reads nested or flat status fields", () => {
    expect(parseHost({ cpu_percent: 12, system: { memory_percent: 40 } }, { posture: "watch" }, 18)).toMatchObject({ cpu: 12, mem: 40, posture: "WATCH", latency: 18 });
    expect(parseHost(null, null, null)).toMatchObject({ available: false, cpu: null, posture: "UNKNOWN" });
  });

  it("threat: drivers as list or text; feed as list or items", () => {
    expect(parseThreat({ level: "high", drivers: "Port scan" }, [{ summary: "x", state: "warn" }])).toMatchObject({ level: "HIGH", drivers: ["Port scan"], feed: [{ text: "x", state: "WARN" }] });
  });

  it("fm: due labels and states", () => {
    const fm = parseFm(getModule("clickup")!.demo!(NOW).clickup, NOW);
    expect(fm.state).toBe("LIVE");
    expect(fm.upcoming.map(dueText)).toEqual(["10D OVERDUE", "OVERDUE 09:00", "TOMORROW"]);
    expect(parseFm(null, NOW).state).toBe("NO FEED");
    expect(parseFm({ schema_version: "x" }, NOW).state).toBe("INVALID");
  });
});

describe("lab touch contracts", () => {
  it("lab-node: live, unreachable, stale, and rates in bits", async () => {
    const { parseLabNode, rateText } = await import("../src/modules/labnode/parse");
    const { uptimeText } = await import("../src/modules/labnode");
    const base = { schema_version: "AP3X-LAB-NODE-1", generated_at: new Date(NOW - 5_000).toISOString(), node: "labpi1", state: "LIVE",
      interfaces: [{ name: "wlan0", kind: "wifi", up: true, rx_bps: 125_000, tx_bps: 0 }, { name: "x", kind: "warp", up: "yes" }],
      history: { step_s: 10, rx_bps: [1, "2", null], tx_bps: "nope" } };
    const live = parseLabNode(base, NOW);
    expect(live.status).toBe("LIVE");
    expect(live.ifaces[1]).toMatchObject({ kind: "other", up: false });
    expect(live.history).toEqual({ stepS: 10, rx: [1, 2, 0], tx: [] });
    expect(parseLabNode({ ...base, state: "UNREACHABLE" }, NOW).status).toBe("UNREACHABLE");
    expect(parseLabNode({ ...base, generated_at: new Date(NOW - 600_000).toISOString() }, NOW).status).toBe("STALE");
    expect(parseLabNode({ schema_version: "NOPE" }, NOW).status).toBe("NO FEED");
    expect(rateText(125_000)).toBe("1.0 Mb/s");
    expect(rateText(62)).toBe("496 b/s");
    expect(rateText(null)).toBe("—");
    expect(uptimeText(3 * 86_400 + 4 * 3_600)).toBe("3d 4h");
    expect(uptimeText(42 * 60)).toBe("42m");
  });

  it("home: tiles summarize each feed and ask the console for their page", () => {
    const home = getModule("lab-home")!;
    const ctx = context(home, home.demo!(NOW), 800);
    ctx.settings = { ...ctx.settings, pages: { printers: "printers" } };
    const model = home.model(ctx) as { cards: { key: string; value: string; page: string | null }[] };
    expect(model.cards.map((c) => c.key)).toEqual(["printers", "nodes", "network"]);
    expect(model.cards[0]!.value).toBe("3/6");
    const body = document.createElement("div");
    home.render(body, model, ctx);
    let asked: string | null = null;
    body.addEventListener("console-page", (event) => { asked = (event as CustomEvent<string>).detail; });
    body.querySelector<HTMLButtonElement>(".home-card")!.click();
    expect(asked).toBe("printers");
    expect(body.querySelectorAll<HTMLButtonElement>(".home-card")[1]!.disabled).toBe(true);
  });

  it("camera: live view needs a stream URL and closes itself", async () => {
    const { openLive, closeLive } = await import("../src/modules/camera");
    const m = { url: "/f.jpg", mode: "live" as const, everyMs: 3000, label: "X1C", streamUrl: "/go2rtc/stream.html?src=x", liveMinutes: 1 };
    openLive({ ...m, streamUrl: null });
    expect(document.querySelector(".cam-live")).toBeNull();
    openLive(m);
    expect(document.querySelector(".cam-live iframe")!.getAttribute("src")).toBe("/go2rtc/stream.html?src=x");
    closeLive();
    expect(document.querySelector(".cam-live")).toBeNull();
  });
});
