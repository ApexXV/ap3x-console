import type { LabDevice, LabModel } from "./index";

export type OwnedPrinter = "x1c" | "m7";
export const OWNED_PRINTERS: OwnedPrinter[] = ["x1c", "m7"];
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

/** Keep feed freshness while recounting just the two user-owned printers. */
export function ownedLabDevices(lab: LabModel): LabModel {
  const byIdentity = new Map<OwnedPrinter, LabDevice>();
  for (const device of lab.devices) {
    const id = ownedPrinter(device);
    if (id && !byIdentity.has(id)) byIdentity.set(id, device);
  }
  const devices = OWNED_PRINTERS.flatMap((id) => byIdentity.get(id) ?? []);
  return {
    ...lab,
    devices,
    expected: OWNED_PRINTERS.length,
    active: devices.filter((d) => ACTIVE.has(d.state)).length,
    errors: devices.filter((d) => d.state === "error").length,
    offline: devices.filter((d) => d.state === "offline").length,
  };
}

/** Keep the lab touchscreen's sample jobs generic when the console is in demo mode. */
export function neutralOwnedDemo(lab: LabModel): LabModel {
  return {
    ...lab,
    devices: lab.devices.map((device) => {
      const id = ownedPrinter(device);
      return {
        ...device,
        note: device.note ? "Sample device status" : null,
        job: device.job ? { ...device.job, name: id === "m7" ? "Sample resin print" : "Sample X1C print" } : null,
      };
    }),
  };
}
