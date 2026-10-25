import { describe, expect, it } from "vitest";
import { ChangeLog } from "../src/core/changes";
import { validateLayout } from "../src/core/layout";
import { SourceHub } from "../src/core/sources";
import command57 from "../layouts/command-57.json";
import ops1080 from "../layouts/ops-1080.json";
import labTouch from "../layouts/lab-touch.json";
import { registerBuiltins } from "../src/modules";
import { getModule } from "../src/core/registry";

registerBuiltins();
const known = (id: string) => Boolean(getModule(id));

describe("layouts", () => {
  it("every shipped layout is valid", () => {
    expect(validateLayout(command57, known)).toEqual([]);
    expect(validateLayout(ops1080, known)).toEqual([]);
    expect(validateLayout(labTouch, known)).toEqual([]);
  });

  it("reports unknown modules, duplicate ids, and bad sizes", () => {
    const bad = structuredClone(command57) as Record<string, any>;
    bad.stage.width = 10;
    bad.regions[0].panels[1].id = bad.regions[0].panels[0].id;
    bad.regions[0].panels[2].module = "nope";
    bad.regions[1].columns = "url(javascript:alert(1))";
    const problems = validateLayout(bad, known);
    expect(problems.some((p) => p.includes("stage.width"))).toBe(true);
    expect(problems.some((p) => p.includes("must be unique"))).toBe(true);
    expect(problems.some((p) => p.includes('"nope" is not a registered module'))).toBe(true);
    expect(problems.some((p) => p.includes("regions[1].columns"))).toBe(true);
    expect(validateLayout(null, known)).toEqual(["layout must be a JSON object"]);
  });
});

describe("SourceHub", () => {
  const spec = { id: "feed", url: "/feed.json", stampField: "generated_at", maxAgeMs: 60_000 };

  it("classifies ok, stale, retained, and down", async () => {
    let now = 1_000_000;
    let answer: unknown = { generated_at: new Date(now - 10_000).toISOString() };
    const hub = new SourceHub(async () => { if (answer instanceof Error) throw answer; return answer; }, () => now, 600_000);
    hub.register(spec);
    expect((await hub.refresh()).feed!.status).toBe("ok");
    answer = { generated_at: new Date(now - 120_000).toISOString() };
    expect((await hub.refresh()).feed!.status).toBe("stale");
    answer = { generated_at: new Date(now).toISOString() };
    await hub.refresh();
    answer = new Error("down");
    now += 60_000;
    const retained = (await hub.refresh()).feed!;
    expect(retained.status).toBe("retained");
    expect(retained.data).toEqual({ generated_at: new Date(now - 60_000).toISOString() });
    now += 700_000;
    expect((await hub.refresh()).feed!.status).toBe("down");
  });

  it("optional feeds stay unknown until they first answer; shared feeds must agree on the URL", async () => {
    const hub = new SourceHub(async () => { throw new Error("404"); });
    hub.register({ id: "printers", url: "/printers.json", optional: true });
    expect((await hub.refresh()).printers!.status).toBe("unknown");
    expect(() => hub.register({ id: "printers", url: "/other.json" })).toThrow(/two URLs/);
  });

  it("the strictest max age wins when modules share a feed", async () => {
    const now = 1_000_000;
    const hub = new SourceHub(async () => ({ generated_at: new Date(now - 90_000).toISOString() }), () => now);
    hub.register({ id: "f", url: "/f", stampField: "generated_at", maxAgeMs: 300_000 });
    hub.register({ id: "f", url: "/f", stampField: "generated_at", maxAgeMs: 60_000 });
    expect((await hub.refresh()).f!.status).toBe("stale");
  });
});

describe("ChangeLog", () => {
  it("merges repeats into one entry with a count, newest first", () => {
    const log = new ChangeLog();
    log.add([{ tone: "warn", kicker: "FEED", text: "A stopped" }], 1);
    log.add([{ tone: "good", kicker: "FEED", text: "B back" }], 2);
    log.add([{ tone: "warn", kicker: "FEED", text: "A stopped" }], 3);
    expect(log.entries.map((c) => [c.text, c.count, c.first, c.at])).toEqual([["A stopped", 2, 1, 3], ["B back", 1, 2, 2]]);
    expect(log.total).toBe(3);
    expect(ChangeLog.from([{ junk: true }, ...log.toJSON()]).entries).toHaveLength(2);
  });
});
