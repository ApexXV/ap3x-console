import { el, tile, tileRow } from "../../core/dom";
import { note, sec, stats } from "../../core/detail";
import { ageText } from "../../core/format";
import type { Chip, ModuleManifest } from "../../core/types";
import { demoLabNode } from "./demo";
import { LAB_NODE_SOURCE, type LabNode, parseLabNode, pctTone, tempTone } from "./parse";

/* LabPi1 health: temperature, load, memory, disk, uptime. */

export function labNodeChip(m: LabNode): Chip {
  if (m.status === "NO FEED") return { label: "NO FEED", tone: "muted" };
  if (m.status === "UNREACHABLE") return { label: "UNREACHABLE", tone: "bad" };
  if (m.status === "STALE") return { label: `STALE ${ageText(m.ageMs) ?? ""}`.trim(), tone: "warn" };
  if (m.system.throttled) return { label: "THROTTLED", tone: "warn" };
  return { label: "LIVE", tone: "good" };
}

/** "3d 4h", "5h 12m", "42m": uptime reads in days, not a stopwatch. */
export function uptimeText(seconds: number | null): string | null {
  if (seconds === null || seconds < 0) return null;
  const d = Math.floor(seconds / 86_400), h = Math.floor((seconds % 86_400) / 3_600), m = Math.floor((seconds % 3_600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

const fixed = (value: number | null, digits = 0, unit = "") => (value === null ? null : `${value.toFixed(digits)}${unit}`);

export const labNodeModule: ModuleManifest<LabNode> = {
  id: "lab-node",
  title: "LABPI1",
  description: "LabPi1's health from its agent: CPU temperature, load, memory, disk, and uptime.",
  version: "1.0.0",
  sources: [LAB_NODE_SOURCE],

  model: (ctx) => parseLabNode(ctx.sources["lab-node"]?.data, ctx.now),

  render(body, m, ctx) {
    if (m.status === "NO FEED") {
      body.replaceChildren(el("p", "empty", "Waiting for LabPi1's agent · install the lab-node collector"));
      return;
    }
    const s = m.system;
    const root = s.disks.find((d) => d.mount === "/") ?? s.disks[0] ?? null;
    const load = s.load1 === null ? null : s.cores ? s.load1 / s.cores : s.load1;
    body.replaceChildren(tileRow([
      tile("CPU", fixed(s.cpuTempC, 0, "°C"), tempTone(s.cpuTempC), s.fanRpm === null ? null : `FAN ${Math.round(s.fanRpm)} RPM`),
      tile("LOAD", fixed(s.load1, 2), load === null ? "muted" : load >= 0.9 ? "warn" : "good", s.cores ? `${s.cores} CORES` : null),
      tile("MEMORY", fixed(s.memUsedPct, 0, "%"), pctTone(s.memUsedPct), s.memTotalGb === null ? null : `OF ${s.memTotalGb.toFixed(0)} GB`),
      tile("DISK", fixed(root?.usedPct ?? null, 0, "%"), pctTone(root?.usedPct ?? null), root ? root.mount : null),
      tile("UPTIME", uptimeText(s.uptimeS), m.status === "LIVE" ? "info" : "muted", m.status === "LIVE" ? "LIVE" : m.status),
    ], ctx.stageWidth < 1600 ? 3 : 5));
    body.firstElementChild?.classList.add("is-fill");
  },

  chip: labNodeChip,

  detail(m) {
    const s = m.system;
    return {
      title: `${m.node} HEALTH`,
      chip: labNodeChip(m),
      foot: m.lastSuccess ? `Agent last answered ${ageText(m.ageMs) ?? "just now"} ago · polled by rackmain1 over Tailscale` : "Polled by rackmain1 over Tailscale",
      columns: "minmax(0, 1fr)", rows: "auto auto minmax(0, 1fr)",
      sections: m.status === "NO FEED" ? [note("No LabPi1 data yet. Install the agent on LabPi1 and the lab-node collector on rackmain1 (ap3x-wall-data-collectors).")] : [
        sec("SYSTEM", stats([
          ["CPU TEMP", fixed(s.cpuTempC, 1, "°C"), tempTone(s.cpuTempC)],
          ["SSD TEMP", fixed(s.nvmeTempC, 0, "°C"), tempTone(s.nvmeTempC), s.nvmeTempC === null ? "no SSD detected" : null],
          ["FAN", s.fanRpm === null ? null : `${Math.round(s.fanRpm)}`, "info", "RPM"],
          ["THROTTLED", s.throttled === null ? null : s.throttled ? "YES" : "NO", s.throttled ? "warn" : "good"],
        ])),
        sec("RESOURCES", stats([
          ["LOAD 1M", fixed(s.load1, 2), "info", s.cores ? `${s.cores} cores` : null],
          ["MEMORY", fixed(s.memUsedPct, 0, "%"), pctTone(s.memUsedPct), s.memTotalGb === null ? null : `of ${s.memTotalGb.toFixed(1)} GB`],
          ["UPTIME", uptimeText(s.uptimeS), "info"],
        ])),
        sec("DISKS", s.disks.length ? stats(s.disks.map((d) => [d.mount, fixed(d.usedPct, 0, "%"), pctTone(d.usedPct), d.totalGb === null ? null : `of ${d.totalGb.toFixed(0)} GB`]), Math.min(4, s.disks.length)) : note("No disks reported.")),
      ],
    };
  },

  demo: demoLabNode,

  changes(previous, next) {
    if (previous.status !== "UNREACHABLE" && next.status === "UNREACHABLE") return [{ tone: "bad", kicker: "LABPI1", text: "LabPi1's agent stopped answering" }];
    if (previous.status === "UNREACHABLE" && next.status === "LIVE") return [{ tone: "good", kicker: "LABPI1", text: "LabPi1's agent is answering again" }];
    if (!previous.system.throttled && next.system.throttled) return [{ tone: "warn", kicker: "LABPI1", text: "LabPi1 is throttling (power or heat)" }];
    return [];
  },

  priority(m) {
    if (m.status === "UNREACHABLE") return { rank: 55, kicker: "LAB", title: "LabPi1 unreachable", summary: "The lab jump box stopped answering over Tailscale.", posture: "DEGRADED", tone: "bad" };
    if (m.system.cpuTempC !== null && m.system.cpuTempC >= 80) return { rank: 45, kicker: "LAB", title: "LabPi1 running hot", summary: `CPU at ${m.system.cpuTempC.toFixed(0)}°C. Check the Pironman fans.`, posture: "WATCH", tone: "warn" };
    return null;
  },
};
