import { el, setTone } from "../../core/dom";
import type { ModuleManifest, Tone } from "../../core/types";
import { deviceLine, labModule, parseLab, PRINTERS_SOURCE, STATE_LABEL, type LabDevice, type LabModel } from "../lab";
import "./mission.css";

export type OwnedPrinter = "x1c" | "m7";
const OWNED: OwnedPrinter[] = ["x1c", "m7"];
const ACTIVE = new Set(["printing", "cutting", "preparing", "paused"]);

const norm = (value: string | null | undefined): string => (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** Exact identities only: the M7 Pro and all other lab devices are excluded. */
export function ownedPrinter(d: LabDevice): OwnedPrinter | null {
  const key = norm(d.key), name = norm(d.name), model = norm(d.model);
  if (key === "m7-pro" || model === "anycubic photon mono m7 pro") return null;
  if (key === "x1c" || model === "bambu lab x1 carbon" || name === "x1c") return "x1c";
  if (key === "m7" || model === "anycubic photon mono m7" || name === "m7" || name === "photon mono m7") return "m7";
  return null;
}

/** Keep the collector's feed status while recounting just the two user-owned printers. */
export function ownedLabDevices(lab: LabModel): LabModel {
  const byIdentity = new Map<OwnedPrinter, LabDevice>();
  for (const device of lab.devices) {
    const id = ownedPrinter(device);
    if (id && !byIdentity.has(id)) byIdentity.set(id, device);
  }
  const devices = OWNED.flatMap((id) => byIdentity.get(id) ?? []);
  return {
    ...lab,
    devices,
    active: devices.filter((d) => ACTIVE.has(d.state)).length,
    errors: devices.filter((d) => d.state === "error").length,
    offline: devices.filter((d) => d.state === "offline").length,
  };
}

const LABEL: Record<OwnedPrinter, string> = { x1c: "X1C", m7: "PHOTON MONO M7" };
const KIND: Record<OwnedPrinter, string> = { x1c: "FDM", m7: "RESIN" };

export const missionLabModule: ModuleManifest<LabModel> = {
  id: "mission-lab",
  title: "X1C & PHOTON MONO M7",
  description: "Read-only status for the user's X1C and Photon Mono M7, with missing collector data shown explicitly.",
  version: "1.0.0",
  sources: [PRINTERS_SOURCE],

  model: (ctx) => ownedLabDevices(parseLab(ctx.sources.printers?.data, ctx.now)),

  render(body, lab, ctx) {
    const grid = el("div", "mission-lab-grid");
    for (const id of OWNED) {
      const d = lab.devices.find((device) => ownedPrinter(device) === id);
      const tile = el("article", "mission-lab-tile");
      const top = el("header");
      top.append(el("b", "", LABEL[id]), el("small", "", KIND[id]));
      if (!d) {
        setTone(tile, "muted");
        tile.append(top, el("strong", "mission-lab-state", lab.status === "NO FEED" ? "NO FEED" : "NOT IN FEED"),
          el("p", "mission-lab-detail", lab.status === "NO FEED" ? "Lab collector unavailable" : `Collector has no ${LABEL[id]} status`));
      } else {
        const [state, tone] = STATE_LABEL[d.state];
        setTone(tile, tone);
        const pct = d.job?.progress;
        const progress = el("div", "mission-lab-progress");
        const bar = el("i");
        bar.style.width = `${Math.max(0, Math.min(100, (pct ?? 0) * 100))}%`;
        progress.append(bar);
        tile.append(top, el("strong", "mission-lab-state", state),
          el("div", "mission-lab-percent", pct === null || pct === undefined ? "" : `${Math.round(pct * 100)}%`),
          progress, el("p", "mission-lab-detail", d.state === "finished" ? "Job finished" : deviceLine(d, ctx.now)));
      }
      grid.append(tile);
    }
    body.replaceChildren(grid);
  },

  chip(lab) {
    if (lab.status === "NO FEED") return { label: "NO FEED", tone: "muted" };
    if (lab.status === "STALE") return { label: "FEED STALE", tone: "warn" };
    if (lab.errors) return { label: `${lab.errors} ERROR`, tone: "bad" };
    if (lab.devices.length < 2) return { label: `${lab.devices.length}/2 IN FEED`, tone: "warn" };
    return { label: lab.active ? `${lab.active} ACTIVE` : "BOTH IN FEED", tone: (lab.active ? "info" : "good") as Tone };
  },

  priority: labModule.priority,
  changes: labModule.changes,
  demo: labModule.demo,
};
