import { afterEach, describe, expect, it, vi } from "vitest";
import { SourceHub } from "../src/core/sources";
import { demoBusiness } from "../src/modules/business/model";
import { parseLab } from "../src/modules/lab";
import { missionHomeModule, missionWorkModule } from "../src/modules/mission";
import { missionLabModule, ownedLabDevices } from "../src/modules/mission/lab";

const NOW = Date.parse("2026-10-25T18:00:00Z");

function sources(module: typeof missionHomeModule | typeof missionWorkModule | typeof missionLabModule, payloads: Record<string, unknown>) {
  const hub = new SourceHub(async () => null, () => NOW);
  for (const source of module.sources) hub.register(source);
  return hub.fromPayloads(payloads);
}

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("AP3X mission touch", () => {
  it("keeps a running focus session through feed rerenders and pauses it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const ctx = {
      now: NOW, mode: "demo" as const, stageWidth: 800,
      settings: missionHomeModule.defaults!,
      sources: sources(missionHomeModule, missionHomeModule.demo!(NOW)),
    };
    const model = missionHomeModule.model(ctx);
    expect(model.cards.map((card) => card.label)).toEqual(["AP3X WORK", "BOOKS", "X1C + M7", "SYSTEMS"]);
    const body = document.createElement("div");
    document.body.append(body);
    missionHomeModule.render(body, model, ctx);
    body.querySelector<HTMLButtonElement>(".mission-focus-toggle")!.click();
    vi.advanceTimersByTime(60_000);
    expect(body.querySelector(".mission-focus-time")?.textContent).toBe("24:00");
    missionHomeModule.render(body, model, ctx);
    expect(body.querySelector(".mission-focus-time")?.textContent).toBe("24:00");
    body.querySelector<HTMLButtonElement>(".mission-focus-toggle")!.click();
    vi.advanceTimersByTime(60_000);
    expect(body.querySelector(".mission-focus-time")?.textContent).toBe("24:00");
    body.remove();
    vi.advanceTimersByTime(1_000);
  });

  it("does not call a retained business feed an empty work queue", () => {
    const payloads = demoBusiness(NOW);
    payloads["business-record"] = { ...(payloads["business-record"] as object), deadlines: [] };
    const ctx = { now: NOW, mode: "demo" as const, stageWidth: 800, settings: {}, sources: sources(missionWorkModule, payloads) };
    ctx.sources["business-record"]!.status = "retained";
    const model = missionWorkModule.model(ctx);
    expect(missionWorkModule.chip!(model).label).toBe("FEED STALE");
    const body = document.createElement("div");
    missionWorkModule.render(body, model, ctx);
    expect(body.textContent).toContain("Business feed stale");
    expect(body.textContent).not.toContain("No open obligations");
  });

  it("shows only the X1C and Photon Mono M7, and labels an absent M7 as missing from the feed", () => {
    const feed = {
      schema_version: "AP3X-PRINTERS-1", generated_at: new Date(NOW).toISOString(),
      devices: [
        { key: "blackbox", name: "BLACKBOX", model: "Bambu Lab X1 Carbon", kind: "fdm", state: "printing" },
        { key: "m7-pro", name: "M7 PRO", model: "Anycubic Photon Mono M7 Pro", kind: "resin", state: "error" },
        { key: "m7", name: "M7", model: "Anycubic Photon Mono M7", kind: "resin", state: "idle" },
        { key: "p2s", name: "P2S", model: "Bambu Lab P2S", kind: "fdm", state: "error" },
      ],
    };
    const owned = ownedLabDevices(parseLab(feed, NOW));
    expect(owned.devices.map((device) => device.key)).toEqual(["blackbox", "m7"]);
    expect([owned.active, owned.errors]).toEqual([1, 0]);

    const live = { ...feed, devices: feed.devices.slice(0, 1) };
    const ctx = { now: NOW, mode: "demo" as const, stageWidth: 800, settings: {}, sources: sources(missionLabModule, { printers: live }) };
    const model = missionLabModule.model(ctx);
    expect(model.devices.map((device) => device.key)).toEqual(["blackbox"]);
    const body = document.createElement("div");
    missionLabModule.render(body, model, ctx);
    expect(body.textContent).toContain("PHOTON MONO M7");
    expect(body.textContent).toContain("NOT IN FEED");
    expect(body.textContent).not.toContain("M7 PRO");

    const homeFeed = { ...live, devices: [{ ...live.devices[0]!, state: "finished" }, feed.devices[1]!, feed.devices[3]!] };
    const homeCtx = { now: NOW, mode: "demo" as const, stageWidth: 800, settings: missionHomeModule.defaults!,
      sources: sources(missionHomeModule, { ...missionHomeModule.demo!(NOW), printers: homeFeed }) };
    const labCard = missionHomeModule.model(homeCtx).cards.find((card) => card.key === "lab");
    expect(labCard?.value).toBe("1/2 IN FEED");
    expect(labCard?.detail).toContain("1/2 in feed");
  });
});
