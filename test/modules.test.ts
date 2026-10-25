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
