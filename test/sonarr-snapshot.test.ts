import { describe, expect, it } from "vitest";
import { sonarrSnapshotModule as module } from "../src/modules/sonarr-snapshot";
import { parseSnapshot } from "../src/modules/sonarr-snapshot/parse";
import type { ModuleContext } from "../src/core/types";

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
