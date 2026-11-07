import { el, setTone } from "../../core/dom";
import type { ModuleManifest, Tone } from "../../core/types";
import { deviceLine, labModule, parseLab, PRINTERS_SOURCE, STATE_LABEL, type LabDevice, type LabModel } from "../lab";
import { OWNED_PRINTERS, ownedLabDevices, ownedPrinter, type OwnedPrinter } from "../lab/owned";
import "./mission.css";

export { ownedLabDevices, ownedPrinter } from "../lab/owned";
export type { OwnedPrinter } from "../lab/owned";

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
    for (const id of OWNED_PRINTERS) {
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
