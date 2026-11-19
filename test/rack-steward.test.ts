import { beforeAll, describe, expect, it } from "vitest";
import { Console } from "../src/core/console";
import { registerModule } from "../src/core/registry";
import { SourceHub } from "../src/core/sources";
import { mediaModule } from "../src/modules/media";
import { rackStewardModule, reportSummary } from "../src/modules/rack-steward";
import { parseReport, REPORT_MAX_AGE } from "../src/modules/rack-steward/parse";
import { operationsPane, operationsSource, readOperations } from "../src/modules/rack-steward/operations";

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

function detailed() {
  const first = { id: "t-0123456789abcdef", name: "<b>Example pack</b>", state: "stalled", raw_state: "stalledDL",
    progress_pct: 24.2, remaining_bytes: 1_000_000, match: "matched", episode_coverage: "verified",
    episodes: [{ series: "Example series", expected: "S04E01–E04", missing: "S04E02–E04" }] };
  return { schema_version: 1, observed_at: stamp, client_status: "ok", sonarr_status: "partial", rows: [first,
    { ...first, id: "t-1111111111111111", name: "Other transfer", state: "error", raw_state: "missingFiles",
      match: "unmatched", episodes: [], episode_coverage: "unknown" },
    { ...first, id: "t-2222222222222222", name: "Incomplete lookup", episode_coverage: "partial",
      episodes: [{ series: "Example series", expected: "S02E01", missing: null }] },
    { ...first, id: "t-3333333333333333", name: "Indexed transfer",
      episodes: [{ series: "Example series", expected: "S03E01", missing: "" }] },
    { ...first, id: "t-4444444444444444", name: "Seeding", raw_state: "stalledUP", match: "unknown",
      episodes: [], episode_coverage: "unknown" }] };
}

function render(feed: unknown) {
  const hub = new SourceHub(async () => null, () => now);
  hub.register(rackStewardModule.sources[0]!);
  const ctx = { sources: hub.fromPayloads({ "rack-steward": feed }), now, mode: "live" as const, settings: {}, stageWidth: 1600 };
  const root = document.createElement("div");
  rackStewardModule.render(root, rackStewardModule.model(ctx), ctx);
  return root;
}

describe("Scheduled Rack Steward reports", () => {
  beforeAll(() => registerModule(mediaModule));
  const ops = { schemaVersion: 1, generatedAt: stamp, status: "degraded",
    host: { cpuPercent: 4, memoryPercent: 70, load1: 1.2, filesystems: [{ mount: "/", usedPercent: 40 }] },
    containers: { total: 5, running: 4, unhealthy: [], stopped: ["maintenance"] },
    incidents: [{ id: "vpn-restarting", title: "VPN restarting", detail: "Three restarts observed" }],
    recovery: { target: "glances", status: "healthy", reason: "Endpoint responding" },
    decision: { action: "defer", reason: "<b>Review host</b>", task: "triage", at: stamp },
    sms: { status: "accepted", detail: "Provider accepted the update" },
    events: [{ at: stamp, kind: "health", message: "Inventory refreshed" }] };

  it("exposes host status, bounded decisions and SMS through Media Pipeline when the media feed is offline", async () => {
    const hub = new SourceHub(async url => url === operationsSource.url ? ops : null, () => now);
    const root = document.createElement("div");
    const wall = new Console({ root, hub, mode: "live", storage: null, clock: () => now, layout: {
      id: "command-57", title: "COMMAND 57", stage: { width: 5120, height: 1440, fontSize: 30 },
      regionColumns: "1fr", regions: [{ id: "ops", title: "Operations", columns: "1fr", rows: "1fr", panels: [{ id: "media", module: "media" }] }],
    } }).mount();
    try {
      await wall.refresh();
      root.querySelector<HTMLElement>("#panel-media h3")!.click();
      root.querySelector<HTMLButtonElement>('button[title="Open rack health, recovery and SMS updates"]')!.click();
      const view = root.querySelector('.detail [aria-label="Rack operations"]')!;
      for (const value of ["VPN restarting", "Three restarts observed", "4 of 5 running", "70%", "Endpoint responding",
        "triage · defer · <b>Review host</b>", "Provider accepted the update", "Inventory refreshed"]) expect(view.textContent).toContain(value);
      expect(view.querySelector("b, button, a, form")).toBeNull();
      root.querySelector<HTMLButtonElement>('button[title="Return to media pipeline"]')!.click();
      root.querySelector<HTMLButtonElement>(".media-live-transfers")!.click();
      expect(root.querySelector(".detail .module-error")?.textContent).toContain("unavailable");
      expect(root.querySelector('.detail [aria-label="Rack operations"]')?.textContent).toContain("Endpoint responding");
    } finally { wall.stop(); }
  });

  it("labels lost, retained and overdue operation samples, including when host or Docker probes fail", async () => {
    let time = now;
    let offline = false;
    let feed: unknown = { ...ops, host: { ...ops.host, cpuPercent: null }, containers: { ...ops.containers, total: null, running: null } };
    const hub = new SourceHub(async () => { if (offline) throw new Error("offline"); return feed; }, () => time);
    hub.register(operationsSource);
    const renderOps = async () => operationsPane(readOperations({ sources: await hub.refresh(), now: time,
      mode: "live", settings: {}, stageWidth: 3200 })).textContent;
    expect(await renderOps()).toContain("Inventory unavailable");
    offline = true;
    expect(await renderOps()).toContain("Last received");
    offline = false;
    time += operationsSource.maxAgeMs! + 1;
    expect(await renderOps()).toContain("Overdue");
    for (const invalid of [{ ...ops, events: [{}] }, { ...ops, host: { ...ops.host, cpuPercent: 300 } },
      { ...ops, generatedAt: new Date(time + 60_001).toISOString() }]) {
      feed = invalid;
      expect(await renderOps()).toContain("operations feed is unavailable");
    }
  });
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

  it("shows one named row per transfer, library evidence and the matching Astra review", () => {
    const data = sample();
    data.issues.push({ ...data.issues[0]!, id: "transfer_detail.review", title: "Transfer review",
      explanation: { ...data.issues[0]!.explanation!, summary: "The example pack has three library gaps." } });
    const root = render({ ...data, transfer_detail: detailed() });
    const rows = [...root.querySelectorAll(".rack-transfer-table tbody tr")];
    expect(rows).toHaveLength(5);
    expect(rows[0]!.textContent).toContain("Missing files");
    expect(rows[0]!.textContent).toContain("No Sonarr queue match");
    const pack = root.querySelector('tr[data-transfer-id="t-0123456789abcdef"]')!;
    expect(pack.querySelector("[data-private]")!.textContent).toBe("<b>Example pack</b>");
    expect(pack.textContent).toContain("S04E02–E04");
    expect(pack.textContent).toContain("24.2%");
    expect(root.querySelector(".rack-transfer-review")!.textContent).toContain("The example pack has three library gaps.");
    expect(root.querySelectorAll(".rack-transfer-review")).toHaveLength(1);
    for (const label of ["No missing episodes", "Library status unknown", "Partial episode coverage", "Stalled upload", "Sonarr match unknown"])
      expect(root.textContent).toContain(label);
    expect(root.querySelectorAll("form, button, a")).toHaveLength(0);
  });

  it("opens Media by clicking its title, shows a named gap before drill-down and keeps the live report action available during a feed outage", async () => {
    let live: unknown = { ...sample(), transfer_detail: detailed() };
    const hub = new SourceHub(async url => url === "/rack-steward-data/current.json" ? live : {}, () => now);
    const root = document.createElement("div");
    const wall = new Console({ root, hub, mode: "live", storage: null, clock: () => now, layout: {
      id: "command-57", title: "COMMAND 57", stage: { width: 5120, height: 1440, fontSize: 30 },
      regionColumns: "1fr", regions: [{ id: "ops", title: "Operations", columns: "1fr", rows: "1fr", panels: [{ id: "media", module: "media" }] }],
    } }).mount();
    try {
      await wall.refresh();
      root.querySelector<HTMLElement>("#panel-media h3")!.click();
      const overview = () => root.querySelector<HTMLElement>(".detail-body > :first-child")!;
      expect(overview().textContent).toContain("Live transfer report");
      expect(overview().textContent).toContain("4 stalled · 1 errored");
      expect(overview().textContent).toContain("<b>Example pack</b>");
      expect(overview().textContent).toContain("Missing · S04E02–E04");
      overview().querySelector<HTMLButtonElement>("button")!.click();
      expect(root.querySelectorAll(".detail .rack-transfer-table tbody tr")).toHaveLength(5);
      root.querySelector<HTMLButtonElement>('.detail button[title="Return to media pipeline"]')!.click();
      live = null;
      await wall.refresh();
      expect(overview().textContent).toContain("Scheduled report unavailable");
      overview().querySelector<HTMLButtonElement>("button")!.click();
      expect(root.querySelector(".detail .module-error")?.textContent).toContain("unavailable");
    } finally { wall.stop(); }
  });

  it("labels retained rows and handles absent, empty or malformed detail independently of the host report", () => {
    const fresh = detailed();
    expect(render(sample()).querySelector(".rack-transfer-table")).toBeNull();
    expect(render({ ...sample(), transfer_detail: { ...fresh, rows: [] } }).textContent).toContain("no stalled or errored");
    expect(render({ ...sample(), transfer_detail: { ...fresh, client_status: "stale" } }).textContent).toContain("Last observed");
    for (const block of [{ ...fresh, client_status: "unavailable", observed_at: null, rows: [] },
      { ...fresh, rows: [...fresh.rows, fresh.rows[0]] }, { ...fresh, rows: [{ ...fresh.rows[0], episodes: [] }] }]) {
      const root = render({ ...sample(), transfer_detail: block });
      expect(root.textContent).toContain("qBittorrent detail unavailable");
      expect(root.textContent).toContain("Three imports are blocked.");
      expect(root.textContent).not.toContain("no stalled or errored");
    }
  });
});
