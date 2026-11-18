import { describe, expect, it } from "vitest";
import { sonarrSnapshotModule as module } from "../src/modules/sonarr-snapshot";
import { parseSnapshot } from "../src/modules/sonarr-snapshot/parse";
import type { Layout, ModuleContext } from "../src/core/types";
import { Console } from "../src/core/console";
import { SourceHub } from "../src/core/sources";
import { registerModule } from "../src/core/registry";
import { mediaModule } from "../src/modules/media";
import pilotLayout from "../layouts/sonarr-snapshot-pilot.json";

const at = "2026-11-18T02:48:02Z";
const ctx: ModuleContext = { mode: "demo", now: Date.parse(at), stageWidth: 1600, settings: {}, sources: {} };

function sample() {
  return {
    schema_version: 1, mode: "saved_snapshot", observed_at: at, client_rechecked_at: at,
    summary: { total_transfers: 3, flagged_transfers: 1, without_transfer_detail: 2, warning_records: 20, library_gaps: 9 },
    rows: [{ id: "example", series: "Family Guy", episodes: "S18E01–E20", state: "missing_files",
      progress_pct: 0, remaining_bytes: 4096, warning_records: 20, indexed_episodes: 11, gap_count: 9,
      gap_episodes: "S18E12–E20", unfillable_episodes: "S18E12–E20" }],
    family_guy: { resolved: [15, 17].map(season => ({ season, indexed: 20, total: 20, queue_records: 0,
      verified_at: at, rerun_at: at })), season18: { manifest_episodes: "S18E01–E11",
      gap_episodes: "S18E12–E20", unfillable_episodes: "S18E12–E20", unfillable_count: 9, checked_at: at } },
  };
}

describe("Sonarr snapshot pilot", () => {
  it("opens the snapshot directly from the wall, preserves the normal Media detail, and tolerates an absent archive", async () => {
    registerModule(mediaModule);
    let archived: unknown = sample();
    const feed = module.sources[0]!.url;
    const hub = new SourceHub(async url => url === feed ? archived : {});
    const root = document.createElement("div");
    const wall = new Console({ root, hub, mode: "live", storage: null, layout: {
      id: "command-57", title: "COMMAND 57", stage: { width: 7680, height: 2160, fontSize: 30 },
      regionColumns: "1fr", regions: [{ id: "ops", title: "Operations", columns: "1fr", rows: "1fr", panels: [{ id: "media", module: "media" }] }],
    }}).mount();
    await wall.refresh();
    const panel = root.querySelector<HTMLElement>("#panel-media")!;
    expect(panel.querySelector(".media-yt")).not.toBeNull();
    expect(panel.querySelector(".media-snapshot")?.textContent).toMatch(/Saved Nov 17.+1 flagged.+9 library gaps/);
    panel.querySelector<HTMLButtonElement>(".media-snapshot")!.click();
    expect(root.querySelector(".detail-title h2")!.textContent).toBe("Sonarr transfers");
    expect(root.querySelectorAll(".detail .snap-table tbody tr")).toHaveLength(1);
    root.querySelector<HTMLElement>(".detail .snap-scroll")!.scrollTop = 480;
    await wall.refresh();
    expect(root.querySelector<HTMLElement>(".detail .snap-scroll")!.scrollTop).toBe(480);
    expect(root.querySelector(".detail .snap-evidence")?.textContent).toContain("S18E12–E20");
    root.querySelector<HTMLButtonElement>('.detail button[title="Return to media pipeline"]')!.click();
    expect(root.querySelector(".detail-title h2")!.textContent).toBe("MEDIA PIPELINE");
    root.querySelector<HTMLButtonElement>('.detail button[title="Open the saved transfer table"]')!.click();
    expect(root.querySelector(".detail-title h2")!.textContent).toBe("Sonarr transfers");
    expect(root.querySelector<HTMLElement>(".detail .snap-scroll")!.scrollTop).toBe(0);
    wall.closeDetail();
    panel.click();
    expect(root.querySelector(".detail-title h2")!.textContent).toBe("MEDIA PIPELINE");
    archived = null;
    await wall.refresh();
    expect(panel.querySelector(".media-snapshot")).toBeNull();
    expect(panel.querySelector(".media-yt")).not.toBeNull();
    wall.stop();
  });

  it("keeps independent table positions and keyboard focus when the dedicated report refreshes", async () => {
    registerModule(module);
    const archive = sample();
    const hub = new SourceHub(async () => archive);
    const root = document.createElement("div");
    document.body.append(root);
    const wall = new Console({ root, hub, mode: "live", storage: null, layout: pilotLayout as Layout }).mount();
    try {
      await wall.refresh();
      const panel = root.querySelector<HTMLElement>(".panel .snap-scroll")!;
      panel.scrollTop = 320;
      root.querySelector<HTMLButtonElement>(".snap-foot button")!.click();
      const detail = root.querySelector<HTMLElement>(".detail .snap-scroll")!;
      detail.scrollTop = 640;
      detail.focus();
      archive.rows[0]!.progress_pct = 25;
      await wall.refresh();
      const updated = root.querySelector<HTMLElement>(".detail .snap-scroll")!;
      expect(root.querySelector<HTMLElement>(".panel .snap-scroll")!.scrollTop).toBe(320);
      expect(updated.scrollTop).toBe(640);
      expect(updated.querySelector("progress")?.value).toBe(25);
      expect(document.activeElement).toBe(updated);
    } finally {
      wall.stop();
      root.remove();
    }
  });
  it("gives each described transfer one row and keeps resolved historical seasons out of the queue", () => {
    const m = parseSnapshot(sample());
    expect(m).not.toBeNull();
    const body = document.createElement("div");
    module.render(body, m, ctx);
    expect(body.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(body.querySelector("tbody progress")?.getAttribute("value")).toBe("0");
    expect(body.querySelector("tbody tr")?.textContent).toContain("S18E12–E20");
    expect(body.querySelectorAll(".snap-case")).toHaveLength(3);
    expect(body.querySelector(".snap-evidence")?.textContent).toContain("This transfer cannot fill S18E12–E20");
    expect(body.textContent).toContain("2 of 3 queue transfers have no saved row detail");
    const detail = module.detail!(m, ctx, { state: {}, rebuild() {} });
    expect(detail.sections[0]?.querySelectorAll("tr[data-transfer-id]")).toHaveLength(1);
  });

  it("rejects invalid counts and missing evidence instead of turning absent rows into healthy claims", () => {
    const a = sample();
    a.family_guy.resolved.pop();
    expect(parseSnapshot(a)).toBeNull();
    const b = sample();
    b.summary.library_gaps = 0;
    expect(parseSnapshot(b)).toBeNull();
    const c = sample();
    c.rows[0]!.progress_pct = 102;
    expect(parseSnapshot(c)).toBeNull();
  });
});
