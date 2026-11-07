import type { LabDevice, LabModel } from "./index";

const EXPECTED = [
  { id: "x1c", name: "X1C", kind: "fdm" },
  { id: "m7", name: "M7", kind: "resin" },
  { id: "m7-pro", name: "M7 PRO", kind: "resin" },
  { id: "h2c", name: "H2C", kind: "fdm" },
  { id: "p2s", name: "P2S", kind: "fdm" },
  { id: "r1", name: "R1 LASER", kind: "laser" },
] as const;

export interface RosterEntry {
  name: string;
  kind: LabDevice["kind"];
  device: LabDevice | null;
}

const norm = (value: string | null | undefined): string => (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

function rosterId(device: LabDevice): string | null {
  const key = norm(device.key), name = norm(device.name), model = norm(device.model);
  if (key === "m7-pro" || model === "anycubic photon mono m7 pro") return "m7-pro";
  if (key === "m7" || model === "anycubic photon mono m7") return "m7";
  if (key === "x1c" || key === "blackbox" || model === "bambu lab x1 carbon" || name === "x1c") return "x1c";
  if (key === "h2c" || model === "bambu lab h2c") return "h2c";
  if (key === "p2s" || model === "bambu lab p2s") return "p2s";
  if (key === "r1" || model === "bambu lab r1") return "r1";
  return null;
}

/** Expected lab devices first, followed by any additional devices from the live collector. */
export function labRosterEntries(lab: LabModel): RosterEntry[] {
  const used = new Set<LabDevice>();
  const entries: RosterEntry[] = EXPECTED.map((expected) => {
    const device = lab.devices.find((candidate) => !used.has(candidate) && rosterId(candidate) === expected.id) ?? null;
    if (device) used.add(device);
    return { name: expected.name, kind: expected.kind, device };
  });
  for (const device of lab.devices) {
    if (!used.has(device)) entries.push({ name: device.name, kind: device.kind, device });
  }
  return entries;
}

export function labRosterCoverage(lab: LabModel): { present: number; expected: number; missing: number } {
  const entries = labRosterEntries(lab).slice(0, EXPECTED.length);
  const present = entries.filter((entry) => entry.device !== null).length;
  return { present, expected: EXPECTED.length, missing: EXPECTED.length - present };
}
