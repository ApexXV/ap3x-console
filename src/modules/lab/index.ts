import { bar, el, setTone, tag } from "../../core/dom";
import { note } from "../../core/detail";
import { ageText, asDict, clockOf, dayLabel, durationText, etaText, num, rows, sinceMs, text } from "../../core/format";
import type { ModuleManifest, Tone } from "../../core/types";
import "./lab.css";

/* Lab printers and laser from the AP3X-PRINTERS-1 feed (rackmain1 lab printer collector). */

type Kind = "fdm" | "resin" | "laser";
type State = "printing" | "cutting" | "preparing" | "paused" | "finished" | "idle" | "error" | "offline" | "unknown";

export interface LabDevice {
  key: string; name: string; model: string | null; kind: Kind; state: State;
  error: string | null; note: string | null; updatedAt: string | null;
  job: { name: string | null; progress: number | null; elapsed: number | null; remaining: number | null; layer: number | null; layers: number | null } | null;
  temps: { nozzle: number | null; nozzleTarget: number | null; bed: number | null; bedTarget: number | null; chamber: number | null; vat: number | null };
  material: string | null; materialLeft: number | null; power: number | null;
}

export interface LabModel {
  status: "LIVE" | "STALE" | "NO FEED";
  devices: LabDevice[];
  active: number; errors: number; offline: number;
}

const KIND_LABEL: Record<Kind, string> = { fdm: "FDM", resin: "RESIN", laser: "LASER" };
export const STATE_LABEL: Record<State, [string, Tone]> = {
  printing: ["PRINTING", "info"], cutting: ["CUTTING", "info"], preparing: ["PREPARING", "info"], paused: ["PAUSED", "warn"],
  finished: ["FINISHED", "good"], idle: ["IDLE", "muted"], error: ["ERROR", "bad"], offline: ["OFFLINE", "muted"], unknown: ["UNKNOWN", "muted"],
};
const ACTIVE = new Set<State>(["printing", "cutting", "preparing", "paused"]);
const STALE_MS = 3 * 60_000;

export function parseLab(payload: unknown, now: number): LabModel {
  const feed = asDict(payload);
  if (feed.schema_version !== "AP3X-PRINTERS-1") return { status: "NO FEED", devices: [], active: 0, errors: 0, offline: 0 };
  const devices: LabDevice[] = rows(feed.devices).map((d) => {
    const job = asDict(d.job), temps = asDict(d.temps);
    const state = (text(d.state)?.toLowerCase() ?? "unknown") as State;
    const kind = (text(d.kind)?.toLowerCase() ?? "fdm") as Kind;
    return {
      key: text(d.key) ?? text(d.name) ?? "device", name: text(d.name) ?? "Device", model: text(d.model),
      kind: KIND_LABEL[kind] ? kind : "fdm", state: STATE_LABEL[state] ? state : "unknown",
      error: text(d.error), note: text(d.note), updatedAt: text(d.updated_at),
      job: Object.keys(job).length ? {
        name: text(job.name), progress: num(job.progress), elapsed: num(job.elapsed_s), remaining: num(job.remaining_s),
        layer: num(job.layer), layers: num(job.layers),
      } : null,
      temps: { nozzle: num(temps.nozzle), nozzleTarget: num(temps.nozzle_target), bed: num(temps.bed), bedTarget: num(temps.bed_target), chamber: num(temps.chamber), vat: num(temps.vat) },
      material: text(d.material), materialLeft: num(d.material_left_pct), power: num(d.laser_power_pct),
    };
  });
  const age = sinceMs(feed.generated_at, now);
  return {
    status: age === null || age > STALE_MS ? "STALE" : "LIVE", devices,
    active: devices.filter((d) => ACTIVE.has(d.state)).length,
    errors: devices.filter((d) => d.state === "error").length,
    offline: devices.filter((d) => d.state === "offline").length,
  };
}

const temp = (now: number | null, target: number | null) => (now === null ? null : `${Math.round(now)}°${target ? `/${Math.round(target)}°` : ""}`);

export function deviceLine(d: LabDevice, now: number): string {
  if (d.state === "error") return d.error ?? "Needs attention";
  if (d.state === "offline") return d.updatedAt ? `Last seen ${dayLabel(d.updatedAt, now)}` : "Not reachable";
  if (d.job && ACTIVE.has(d.state)) {
    return [d.job.remaining !== null ? `${etaText(d.job.remaining)} LEFT` : null,
      d.job.layers ? `L ${d.job.layer ?? 0}/${d.job.layers}` : null,
      d.kind === "fdm" ? temp(d.temps.nozzle, d.temps.nozzleTarget) : d.kind === "resin" && d.temps.vat !== null ? `VAT ${Math.round(d.temps.vat)}°` : null,
    ].filter(Boolean).join(" · ");
  }
  if (d.state === "finished") return d.job?.name ? `Done · ${d.job.name}` : "Job finished";
  return d.note ?? ([d.model, d.material].filter(Boolean).join(" · ") || "Ready");
}

const chipFor = (m: LabModel): { label: string; tone: Tone } =>
  m.status === "NO FEED" ? { label: "NO FEED", tone: "muted" }
    : m.status === "STALE" ? { label: "FEED STALE", tone: "bad" }
      : m.errors ? { label: `${m.errors} ERROR`, tone: "bad" }
        : m.active ? { label: `${m.active} ACTIVE`, tone: "info" } : { label: "ALL IDLE", tone: "good" };

export const labModule: ModuleManifest<LabModel> = {
  id: "lab-printers",
  title: "LAB · PRINTERS & LASER",
  description: "3D printers and laser cutters: state, job progress, time left, layers, temperatures, and material.",
  version: "1.0.0",
  sources: [{ id: "printers", url: "/printers-data/current.json", schema: "AP3X-PRINTERS-1", stampField: "generated_at", maxAgeMs: STALE_MS, optional: true }],

  model: (ctx) => parseLab(ctx.sources.printers?.data, ctx.now),

  render(body, m, ctx) {
    if (!m.devices.length) { body.replaceChildren(el("p", "empty", m.status === "NO FEED" ? "No printer feed yet" : "No devices in the feed")); return; }
    const grid = el("div", "lab-grid");
    grid.append(...m.devices.slice(0, 6).map((d) => {
      const [label, tone] = STATE_LABEL[d.state];
      const tile = el("div", `lab-tile is-${d.state}`);
      setTone(tile, tone);
      const head = el("div", "lab-head");
      head.append(el("b", "", d.name), el("span", "lab-kind", KIND_LABEL[d.kind]), el("em", "", label));
      const pct = d.job?.progress ?? (d.state === "finished" ? 1 : null);
      const showing = ACTIVE.has(d.state) || d.state === "finished";
      const meter = el("div", "lab-meter");
      meter.append(bar(showing ? pct ?? 0 : 0, tone), el("span", "", showing && pct !== null ? `${Math.round(pct * 100)}%` : ""));
      tile.append(head, meter, el("small", "", deviceLine(d, ctx.now)));
      return tile;
    }));
    body.replaceChildren(grid);
  },

  chip: chipFor,

  detail(m, ctx) {
    const cards = el("div", "lab-cards");
    cards.append(...m.devices.map((d) => {
      const [label, tone] = STATE_LABEL[d.state];
      const card = el("section", `lab-card is-${d.state}`);
      setTone(card, tone);
      const head = el("header");
      const title = el("div");
      title.append(el("b", "", d.name), el("small", "", [KIND_LABEL[d.kind], d.model].filter(Boolean).join(" · ")));
      head.append(title, tag(label, tone));
      card.append(head);
      if (d.job) card.append(el("p", "lab-job", d.job.name ?? "Unnamed job"));
      const pct = d.job?.progress ?? (d.state === "finished" ? 1 : null);
      const big = el("div", "lab-big");
      const remaining = d.job?.remaining ?? null;
      big.append(el("b", "", ACTIVE.has(d.state) || d.state === "finished" ? (pct !== null ? `${Math.round(pct * 100)}%` : label) : label),
        el("span", "", ACTIVE.has(d.state) && remaining !== null
          ? `${etaText(remaining)} LEFT · DONE ${clockOf(new Date(ctx.now + remaining * 1000).toISOString())}` : deviceLine(d, ctx.now)));
      card.append(big);
      const t = d.temps;
      const facts: [string, string][] = [
        ["STATE", d.state === "error" ? d.error ?? "ERROR" : label],
        ...(d.job?.layers ? [["LAYER", `${d.job.layer ?? 0} / ${d.job.layers}`] as [string, string]] : []),
        ...(d.job && d.job.elapsed !== null ? [["ELAPSED", durationText(d.job.elapsed)] as [string, string]] : []),
        ...(d.kind === "fdm" ? [["NOZZLE", temp(t.nozzle, t.nozzleTarget) ?? "—"], ["BED", temp(t.bed, t.bedTarget) ?? "—"]] as [string, string][] : []),
        ...(t.chamber !== null ? [["CHAMBER", `${Math.round(t.chamber)}°`] as [string, string]] : []),
        ...(d.kind === "resin" ? [["VAT", t.vat !== null ? `${Math.round(t.vat)}°` : "—"] as [string, string]] : []),
        ...(d.kind === "laser" && d.power !== null ? [["POWER", `${Math.round(d.power)}%`] as [string, string]] : []),
        ...(d.material ? [["MATERIAL", d.material] as [string, string]] : []),
        ...(d.materialLeft !== null ? [["REMAINING", `${Math.round(d.materialLeft)}%`] as [string, string]] : []),
        ["UPDATED", d.updatedAt ? `${ageText(sinceMs(d.updatedAt, ctx.now))} ago` : "—"],
      ];
      const grid = el("div", "facts");
      for (const [k, v] of facts) {
        const cell = el("div");
        cell.append(el("span", "", k), el("b", "", v));
        grid.append(cell);
      }
      card.append(grid);
      return card;
    }));
    return {
      title: "LAB · PRINTERS & LASER", chip: chipFor(m),
      foot: `${m.devices.length} devices · read-only status from the lab collector`,
      columns: "minmax(0, 1fr)", rows: "minmax(0, 1fr)",
      sections: [m.devices.length ? cards : note("No printer feed yet. Set up the lab collector (ap3x-wall-data-collectors, docs/printers-contract.md).")],
    };
  },

  changes(previous, next) {
    const events = [];
    for (const d of next.devices) {
      const before = previous.devices.find((p) => p.key === d.key);
      if (!before || before.state === d.state) continue;
      if (d.state === "finished") events.push({ tone: "good" as Tone, kicker: "LAB", text: `${d.name} finished${d.job?.name ? ` · ${d.job.name}` : ""}` });
      else if (d.state === "error") events.push({ tone: "bad" as Tone, kicker: "LAB", text: `${d.name}: ${d.error ?? "error"}` });
      else if (d.state === "offline") events.push({ tone: "warn" as Tone, kicker: "LAB", text: `${d.name} went offline` });
      else if (ACTIVE.has(d.state) && !ACTIVE.has(before.state)) events.push({ tone: "info" as Tone, kicker: "LAB", text: `${d.name} started${d.job?.name ? ` · ${d.job.name}` : ""}` });
    }
    return events;
  },

  priority(m) {
    const jammed = m.devices.filter((d) => d.state === "error");
    const first = jammed[0];
    if (!first) return null;
    return {
      rank: 70, kicker: "LAB / PRINTER", title: `${first.name}: ${first.error ?? "needs attention"}`,
      summary: jammed.length > 1 ? `${jammed.length} lab devices report errors` : `${first.job?.name ? `Job ${first.job.name} · ` : ""}${Math.round((first.job?.progress ?? 0) * 100)}% when it stopped`,
      posture: "ERROR", tone: "bad",
    };
  },

  demo(now) {
    const at = (min: number) => new Date(now + min * 60_000).toISOString();
    return {
      printers: {
        schema_version: "AP3X-PRINTERS-1", generated_at: at(0),
        devices: [
          { key: "m7-pro", name: "M7 PRO", kind: "resin", model: "Anycubic Photon Mono M7 Pro", state: "printing", material: "Grey resin", material_left_pct: 62, temps: { vat: 27 },
            job: { name: "viola-top-plate-jig", progress: 0.58, elapsed_s: 5400, remaining_s: 3900, layer: 1210, layers: 2086 }, updated_at: at(0) },
          { key: "m7", name: "M7", kind: "resin", model: "Anycubic Photon Mono M7", state: "idle", note: "Last job stopped at 37%", temps: { vat: 22 }, updated_at: at(0) },
          { key: "x1c", name: "X1C", kind: "fdm", model: "Bambu Lab X1 Carbon", state: "printing", material: "PETG", temps: { nozzle: 240, nozzle_target: 240, bed: 80, bed_target: 80 },
            job: { name: "harp-string-guide", progress: 0.91, elapsed_s: 9800, remaining_s: 1020, layer: 182, layers: 200 }, updated_at: at(0) },
          { key: "h2c", name: "H2C", kind: "fdm", model: "Bambu Lab H2C", state: "finished", material: "PLA",
            job: { name: "panel-knobs-x12", progress: 1, elapsed_s: 7200, remaining_s: 0 }, updated_at: at(0) },
          { key: "p2s", name: "P2S", kind: "fdm", model: "Bambu Lab P2S", state: "error", error: "Printer error 0700-8001", material: "PLA",
            temps: { nozzle: 210, nozzle_target: 210, bed: 60, bed_target: 60 }, job: { name: "bracket-v3", progress: 0.37, elapsed_s: 3100, remaining_s: 5300, layer: 88, layers: 240 }, updated_at: at(0) },
          { key: "r1", name: "R1 LASER", kind: "laser", model: "Bambu Lab R1", state: "cutting", laser_power_pct: 70, material: "3 mm birch ply",
            job: { name: "fret-template", progress: 0.24, elapsed_s: 300, remaining_s: 950 }, updated_at: at(0) },
        ],
      },
    };
  },
};
