import { describe, expect, it } from "vitest";
import { sonarrSnapshotModule as module } from "../src/modules/sonarr-snapshot";
import { parseSnapshot } from "../src/modules/sonarr-snapshot/parse";
import type { Layout, ModuleContext } from "../src/core/types";
import { Console } from "../src/core/console";
import { SourceHub } from "../src/core/sources";
import { registerModule } from "../src/core/registry";
import { mediaModule } from "../src/modules/media";
import pilotLayout from "../layouts/sonarr-snapshot-pilot.json";

const at = "2030-03-14T10:00:00Z";
const ctx: ModuleContext = { mode: "demo", now: Date.parse(at), stageWidth: 1600, settings: {}, sources: {} };

function sample() {
  return {
    schema_version: 1, mode: "saved_snapshot", observed_at: at, client_rechecked_at: at,
    summary: { total_transfers: 3, flagged_transfers: 1, without_transfer_detail: 2, warning_records: 7, library_gaps: 3 },
    rows: [{ id: "example", series: "Family Guy", episodes: "S18E02–E08", state: "missing_files",
      progress_pct: 0, remaining_bytes: 4096, warning_records: 7, indexed_episodes: 4, gap_count: 3,
      gap_episodes: "S18E04, S18E07–E08", unfillable_episodes: "S18E04, S18E07–E08" }],
    family_guy: { resolved: [15, 17].map(season => ({ season, indexed: 20, total: 20, queue_records: 0,
      verified_at: at, rerun_at: at })), season18: { manifest_episodes: "S18E03, S18E05–E06",
      gap_episodes: "S18E04, S18E07–E08", unfillable_episodes: "S18E04, S18E07–E08", unfillable_count: 3, checked_at: at } },
  };
}

function savedExplanation() {
  return {
    schema_version: 1, kind: "bbx.sonarr-explanation", case_id: "family-guy-s18",
    observed_at: at, generated_at: "2030-03-14T10:05:00Z", model: "test-model", evidence_sha256: "a".repeat(64),
    evidence: { expected: "S18E02–E08", indexed: "S18E02–E03, S18E05–E06", transfer: "S18E03, S18E05–E06", missing: "S18E04, S18E07–E08" },
    explanation: { summary: "The transfer lacks all three missing episodes.", next_step: "Review coverage for episodes 4, 7 and 8.",
      evidence_ids: ["sonarr.indexed", "qbit.manifest", "sonarr.expected"] },
  };
}

describe("Sonarr snapshot pilot", () => {
  it("opens the snapshot directly from the wall, preserves the normal Media detail, and tolerates an absent archive", async () => {
    registerModule(mediaModule);
    let archived: unknown = sample();
    const feed = module.sources[0]!.url;
    const hub = new SourceHub(async url => url === feed ? archived : url === "/sonarr-snapshot-data/s18-explanation.json" ? savedExplanation() : {});
    const root = document.createElement("div");
    const wall = new Console({ root, hub, mode: "live", storage: null, layout: {
      id: "command-57", title: "COMMAND 57", stage: { width: 7680, height: 2160, fontSize: 30 },
      regionColumns: "1fr", regions: [{ id: "ops", title: "Operations", columns: "1fr", rows: "1fr", panels: [{ id: "media", module: "media" }] }],
    }}).mount();
    await wall.refresh();
    const panel = root.querySelector<HTMLElement>("#panel-media")!;
    expect(panel.querySelector(".media-yt")).not.toBeNull();
    expect(panel.querySelector(".media-snapshot")?.textContent).toMatch(/Saved Mar 14.+1 flagged.+3 library gaps/);
    panel.querySelector<HTMLButtonElement>(".media-snapshot")!.click();
    expect(root.querySelector(".detail-title h2")!.textContent).toBe("Sonarr transfers");
    expect(root.querySelectorAll(".detail .snap-table tbody tr")).toHaveLength(1);
    expect(root.querySelector(".detail .snap-explanation")?.textContent).toContain(savedExplanation().explanation.summary);
    root.querySelector<HTMLElement>(".detail .snap-scroll")!.scrollTop = 480;
    root.querySelector<HTMLElement>(".detail .snap-evidence")!.scrollTop = 125;
    await wall.refresh();
    expect(root.querySelector<HTMLElement>(".detail .snap-scroll")!.scrollTop).toBe(480);
    expect(root.querySelector<HTMLElement>(".detail .snap-evidence")!.scrollTop).toBe(125);
    expect(root.querySelector(".detail .snap-evidence")?.textContent).toContain("S18E04, S18E07–E08");
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
    expect(body.querySelector("tbody tr")?.textContent).toContain("S18E04, S18E07–E08");
    expect(body.querySelectorAll(".snap-case")).toHaveLength(3);
    expect(body.querySelector(".snap-evidence")?.textContent).toContain("This transfer cannot fill S18E04, S18E07–E08");
    expect(body.textContent).toContain("2 of 3 queue transfers have no saved row detail");
    const detail = module.detail!(m, ctx, { state: {}, rebuild() {} });
    expect(detail.sections[0]?.querySelectorAll("tr[data-transfer-id]")).toHaveLength(1);
  });

  it("renders attributed plain text for the matching observation in the dedicated report", () => {
    const report = savedExplanation();
    report.explanation.next_step = "Review the literal text <img src=x> in the report.";
    const body = document.createElement("div");
    const hub = new SourceHub();
    module.sources.forEach(source => hub.register(source));
    const sources = hub.fromPayloads({ "sonarr-snapshot": sample(), "sonarr-explanation": report });
    const liveCtx: ModuleContext = { ...ctx, sources, mode: "live" };
    module.render(body, module.model(liveCtx), liveCtx);
    const result = body.querySelector(".snap-explanation")!;
    expect(result.textContent).toContain(report.explanation.summary);
    expect(result.textContent).toContain(report.explanation.next_step);
    expect(result.textContent).toContain("test-model");
    expect(result.querySelector("img,button,a")).toBeNull();
    expect(body.querySelector(".snap-case strong")?.textContent).toBe("Season 18");
    const demoCtx: ModuleContext = { ...liveCtx, mode: "demo" };
    module.render(body, module.model(demoCtx), demoCtx);
    expect(body.querySelector(".snap-explanation")).toBeNull();
  });

  it("keeps the archive usable with absent, mismatched or malformed analysis", () => {
    const archive = sample();
    const report = savedExplanation();
    for (const invalid of [undefined, { ...report, observed_at: "2030-03-14T06:00:00Z" },
      { ...report, generated_at: "2030-03-12T06:00:00Z" }, { ...report, evidence_sha256: "broken" },
      { ...report, evidence: { ...report.evidence, indexed: "S18E02–E05" } },
      { ...report, evidence: { ...report.evidence, missing: "S18E04, S18E08, S18E08" } },
      { ...report, evidence: { ...report.evidence, transfer: "S18E03–E06" } },
      { ...report, evidence: { ...report.evidence, transfer: "S19E03, S18E05–E06" } },
      { ...report, evidence: { ...report.evidence, expected: "S18E01–E9999" } },
      { ...report, explanation: { ...report.explanation, evidence_ids: ["sonarr.expected", "sonarr.indexed"] } },
      { ...report, explanation: { ...report.explanation, summary: "a".repeat(601) } }]) {
      const parsed = parseSnapshot(archive, invalid)!;
      expect(parsed.explanation).toBeNull();
      expect(parsed.manifest.unfillable_count).toBe(3);
    }
    const changed = sample();
    changed.family_guy.season18.manifest_episodes = "S18E02–E03";
    expect(parseSnapshot(changed, report)!.explanation).toBeNull();
    archive.rows[0]!.indexed_episodes = 3;
    expect(parseSnapshot(archive, report)!.explanation).toBeNull();
  });

  it("binds the explanation to one matching missing-files transfer", () => {
    const archive = sample();
    const row = archive.rows[0]!;
    row.state = "stalled";
    expect(parseSnapshot(archive, savedExplanation())!.explanation).toBeNull();
    row.state = "missing_files";
    archive.rows.push({ ...row, id: "other" });
    archive.summary.flagged_transfers++;
    archive.summary.total_transfers++;
    archive.summary.warning_records += row.warning_records;
    archive.summary.library_gaps += row.gap_count;
    expect(parseSnapshot(archive, savedExplanation())!.explanation).toBeNull();
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
