import { describe, expect, it } from "vitest";
import labTouch from "../layouts/lab-touch.json";
import { SourceHub } from "../src/core/sources";
import { homeModule } from "../src/modules/home";
import { labModule } from "../src/modules/lab";

const NOW = Date.parse("2026-10-25T18:00:00Z");
const feed = {
  schema_version: "AP3X-PRINTERS-1", generated_at: new Date(NOW).toISOString(),
  devices: [
    { key: "blackbox", name: "BLACKBOX", model: "Bambu Lab X1 Carbon", kind: "fdm", state: "printing" },
    { key: "m7-pro", name: "M7 PRO", model: "Anycubic Photon Mono M7 Pro", kind: "resin", state: "error" },
    { key: "m7", name: "M7", model: "Anycubic Photon Mono M7", kind: "resin", state: "idle" },
    { key: "p2s", name: "P2S", model: "Bambu Lab P2S", kind: "fdm", state: "error" },
  ],
};

function sources(module: typeof homeModule | typeof labModule, printers: unknown) {
  const hub = new SourceHub(async () => null, () => NOW);
  for (const source of module.sources) hub.register(source);
  return hub.fromPayloads({ printers });
}

describe("lab touch owned printer scope", () => {
  it("keeps the lab pages while selecting only the two owned printers and camera streams", () => {
    expect(labTouch.regions.map((region) => region.id)).toEqual(["home", "printers", "cameras", "climate", "network"]);
    for (const index of [0, 1]) {
      const panel = labTouch.regions[index]?.panels[0];
      expect(panel && "settings" in panel && "ownedOnly" in panel.settings && panel.settings.ownedOnly).toBe(true);
    }
    expect(labTouch.regions[2]?.panels.map((panel) => panel.id)).toEqual(["cam-lab", "cam-x1c"]);
  });

  it("filters the printer page and HOME summary without changing the general lab module", () => {
    const ctx = { now: NOW, mode: "demo" as const, stageWidth: 800, settings: { ownedOnly: true }, sources: sources(labModule, feed) };
    const model = labModule.model(ctx);
    expect(model.devices.map((device) => device.key)).toEqual(["blackbox", "m7"]);
    expect([model.active, model.errors, model.expected]).toEqual([1, 0, 2]);
    const body = document.createElement("div");
    labModule.render(body, model, ctx);
    expect(body.querySelector(".lab-grid.is-owned")).not.toBeNull();
    expect(body.textContent).toContain("PHOTON MONO M7");
    expect(body.textContent).not.toContain("M7 PRO");
    expect(body.textContent).not.toContain("P2S");

    const homeCtx = { now: NOW, mode: "demo" as const, stageWidth: 800,
      settings: { place: "LAB", ownedOnly: true, pages: { printers: "printers" } }, sources: sources(homeModule, feed) };
    const card = homeModule.model(homeCtx).cards.find((item) => item.key === "printers");
    expect(card?.value).toBe("1/2");
    expect(card?.detail).not.toContain("need attention");

    expect(labModule.model({ ...ctx, settings: {} }).devices).toHaveLength(4);
  });

  it("shows the M7 as absent when its collector data is missing", () => {
    const ctx = { now: NOW, mode: "demo" as const, stageWidth: 800, settings: { ownedOnly: true },
      sources: sources(labModule, { ...feed, devices: feed.devices.slice(0, 1) }) };
    const model = labModule.model(ctx);
    expect(labModule.chip!(model).label).toBe("1/2 IN FEED");
    const body = document.createElement("div");
    labModule.render(body, model, ctx);
    expect(body.textContent).toContain("PHOTON MONO M7");
    expect(body.textContent).toContain("NOT IN FEED");
  });

  it("uses neutral sample jobs and distinguishes absent devices from a missing feed", () => {
    const demoCtx = { now: NOW, mode: "demo" as const, stageWidth: 800, settings: { ownedOnly: true },
      sources: sources(labModule, labModule.demo!(NOW).printers) };
    const demo = labModule.model(demoCtx);
    expect(demo.devices.find((device) => device.key === "x1c")?.job?.name).toBe("Sample X1C print");
    expect(demo.devices.find((device) => device.key === "m7")?.note).toBe("Sample device status");

    const otherOnlyCtx = { ...demoCtx, sources: sources(labModule, { ...feed, devices: feed.devices.slice(1, 2) }) };
    const otherOnly = labModule.model(otherOnlyCtx);
    expect(otherOnly.devices).toHaveLength(0);
    const detail = labModule.detail!(otherOnly, otherOnlyCtx, { state: {}, rebuild() {} });
    expect(detail.sections[0]?.textContent).toContain("X1C and Photon Mono M7 are not in the collector feed yet");
  });
});
