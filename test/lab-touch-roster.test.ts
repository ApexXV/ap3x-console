import { describe, expect, it } from "vitest";
import labTouch from "../layouts/lab-touch.json";
import missionTouch from "../layouts/mission-touch.json";
import { SourceHub } from "../src/core/sources";
import { homeModule } from "../src/modules/home";
import { labModule } from "../src/modules/lab";

const NOW = Date.parse("2026-10-25T18:00:00Z");
const feed = {
  schema_version: "AP3X-PRINTERS-1", generated_at: new Date(NOW).toISOString(),
  devices: [
    { key: "blackbox", name: "BLACKBOX", model: "Bambu Lab X1 Carbon", kind: "fdm", state: "printing" },
    { key: "r1", name: "R1 LASER", model: "Bambu Lab R1", kind: "laser", state: "offline" },
    { key: "extra", name: "EXTRA DEVICE", model: "Other", kind: "fdm", state: "idle" },
  ],
};

function sources(module: typeof homeModule | typeof labModule, printers: unknown) {
  const hub = new SourceHub(async () => null, () => NOW);
  for (const source of module.sources) hub.register(source);
  return hub.fromPayloads({ printers });
}

describe("full lab touchscreen roster", () => {
  it("restores all lab camera tiles while Mission Touch remains separate", () => {
    expect(labTouch.regions.map((region) => region.id)).toEqual(["home", "printers", "cameras", "climate", "network"]);
    for (const index of [0, 1]) {
      const panel = labTouch.regions[index]?.panels[0];
      expect(panel && "settings" in panel && "fullRoster" in panel.settings && panel.settings.fullRoster).toBe(true);
    }
    expect(labTouch.regions[2]?.panels.map((panel) => panel.id)).toEqual(["cam-lab", "cam-x1c", "cam-h2c", "cam-p2s", "cam-r1"]);
    expect(missionTouch.regions.find((region) => region.id === "lab")?.panels[0]?.module).toBe("mission-lab");
  });

  it("shows absent roster cards and real offline status without altering feed counts", () => {
    const ctx = { now: NOW, mode: "live" as const, stageWidth: 800, settings: { fullRoster: true }, sources: sources(labModule, feed) };
    const model = labModule.model(ctx);
    expect(model.devices.map((device) => device.key)).toEqual(["blackbox", "r1", "extra"]);
    expect(model.roster).toEqual({ present: 2, expected: 6, missing: 4 });
    expect([model.active, model.errors, model.offline]).toEqual([1, 0, 1]);

    const body = document.createElement("div");
    labModule.render(body, model, ctx);
    expect(body.querySelectorAll(".lab-tile")).toHaveLength(7);
    expect(body.textContent).toContain("M7 PRO");
    expect(body.textContent).toContain("NOT IN FEED");
    expect(body.textContent).toContain("R1 LASER");
    expect(body.textContent).toContain("OFFLINE");
    expect(body.textContent).toContain("EXTRA DEVICE");

    const detail = labModule.detail!(model, ctx, { state: { device: 1 }, rebuild() {} });
    expect(detail.sections[0]?.querySelectorAll("button")).toHaveLength(7);
    expect(detail.sections[1]?.textContent).toContain("M7");
    expect(detail.sections[1]?.textContent).toContain("NOT IN FEED");
    expect(labModule.model({ ...ctx, settings: {} }).roster).toBeUndefined();
  });

  it("shows expected feed coverage on HOME instead of calling missing devices idle", () => {
    const ctx = { now: NOW, mode: "live" as const, stageWidth: 800,
      settings: { place: "LAB", fullRoster: true, pages: { printers: "printers" } }, sources: sources(homeModule, feed) };
    const card = homeModule.model(ctx).cards.find((item) => item.key === "printers");
    expect(card?.value).toBe("2/6");
    expect(card?.detail).toBe("4 not in feed");
    expect(card?.tone).toBe("warn");
  });
});
