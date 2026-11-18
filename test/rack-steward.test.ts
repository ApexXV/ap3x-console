import { describe, expect, it } from "vitest";
import { Console } from "../src/core/console";
import { registerModule } from "../src/core/registry";
import { SourceHub } from "../src/core/sources";
import { mediaModule } from "../src/modules/media";
import { rackStewardModule, reportSummary } from "../src/modules/rack-steward";
import { parseReport, REPORT_MAX_AGE } from "../src/modules/rack-steward/parse";

const stamp = "2030-03-14T08:00:00Z";
const now = Date.parse(stamp);
function sample() {
  return { schema_version: 1, kind: "bbx.scheduled-report", observed_at: stamp,
    sources: [{ id: "queue", status: "ok", observed_at: stamp }, { id: "archive", status: "unavailable", observed_at: null }],
    issues: [{ id: "queue.blocked", title: "Queue requires attention", evidence: { blocked: 3 },
      status: "active", change: "changed", explanation: { model: "gpt-6.2-astra", generated_at: stamp,
        summary: "Three imports are blocked.", next_step: "Review the import queue." } },
    { id: "archive.held", title: "Importer held", evidence: { blocked: 1 }, status: "unconfirmed", change: "ongoing", explanation: null }],
    recovered: [{ id: "queue.offline", title: "Queue unavailable", recovered_at: stamp }],
    analysis: { status: "current", pending: 0 } };
}

describe("Scheduled Rack Steward reports", () => {
  it("marks missing coverage, cached copies and overdue runs distinctly", () => {
    const data = { ...sample(), issues: [] };
    expect(reportSummary(parseReport(data, now)!)).toBe("Partial coverage");
    expect(reportSummary(parseReport(data, now, true)!)).toBe("Last report");
    expect(reportSummary(parseReport(data, now + REPORT_MAX_AGE + 1)!)).toBe("Report overdue");
    expect(parseReport({ ...data, sources: [] }, now)).toBeNull();
    expect(parseReport({ ...data, issues: [...sample().issues, ...sample().issues] }, now)).toBeNull();
    expect(parseReport({ ...data, recovered: [{ title: "Inconsistent" }] }, now)).toBeNull();
  });

  it("opens the scheduled wall report, preserves its reading position and offers manual follow-up", async () => {
    registerModule(mediaModule);
    const data = sample();
    const hub = new SourceHub(async url => url === "/rack-steward-data/current.json" ? data : {}, () => now);
    const root = document.createElement("div");
    const wall = new Console({ root, hub, mode: "live", storage: null, clock: () => now, layout: {
      id: "command-57", title: "COMMAND 57", stage: { width: 7680, height: 2160, fontSize: 30 },
      regionColumns: "1fr", regions: [{ id: "ops", title: "Operations", columns: "1fr", rows: "1fr", panels: [{ id: "media", module: "media" }] }],
    }}).mount();
    try {
      await wall.refresh();
      const launch = root.querySelector<HTMLButtonElement>("#panel-media .media-rack-report")!;
      expect(launch.textContent).toContain("1 active issue");
      launch.click();
      const report = root.querySelector(".detail .rack-report")!;
      for (const text of ["Changed", "Manual repairs", "Three imports are blocked.", "Review the import queue.", "gpt-6.2-astra", "Unconfirmed",
        "Source coverage · 1/2", "Unavailable", "Recovered in the past 24 hours"]) expect(report.textContent).toContain(text);
      expect(report.querySelectorAll("button, form, a")).toHaveLength(0);
      root.querySelector<HTMLElement>('.detail [aria-label="Rack Steward issues"]')!.scrollTop = 125;
      await wall.refresh();
      expect(root.querySelector<HTMLElement>('.detail [aria-label="Rack Steward issues"]')!.scrollTop).toBe(125);
      root.querySelector<HTMLButtonElement>('.detail button[title="Return to media pipeline"]')!.click();
      expect(root.querySelector(".detail-title h2")!.textContent).toBe("MEDIA PIPELINE");
    } finally { wall.stop(); }
  });

  it("renders untrusted model prose as text and suppresses demo attribution", () => {
    const data = sample();
    data.issues[0]!.explanation!.summary = "<img src=x> synthetic";
    const hub = new SourceHub(async () => null, () => now);
    hub.register(rackStewardModule.sources[0]!);
    const ctx = { sources: hub.fromPayloads({ "rack-steward": data }), now, mode: "live" as const, settings: {}, stageWidth: 1600 };
    const panel = document.createElement("div");
    rackStewardModule.render(panel, rackStewardModule.model(ctx), ctx);
    expect(panel.querySelector("img")).toBeNull();
    expect(panel.textContent).toContain("<img src=x> synthetic");
    expect(rackStewardModule.model({ ...ctx, mode: "demo" })).toBeNull();
  });
});
