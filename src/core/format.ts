/* Shared parsing and formatting helpers. Every module's model() runs untrusted JSON through these. */

export const TZ = "America/New_York";

export function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export const asDict = (value: unknown): Record<string, unknown> => (record(value) ? value : {});

export function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(record) : [];
}

export function num(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

export function text(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

export function sinceMs(stamp: unknown, now = Date.now()): number | null {
  const parsed = Date.parse(text(stamp) ?? "");
  return Number.isFinite(parsed) ? Math.max(0, now - parsed) : null;
}

export function clockOf(stamp: unknown, tz = TZ): string {
  const parsed = Date.parse(text(stamp) ?? "");
  if (!Number.isFinite(parsed)) return "--:--";
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(parsed);
}

export function dayOf(stamp: unknown, tz = TZ): string | null {
  const parsed = Date.parse(text(stamp) ?? "");
  if (!Number.isFinite(parsed)) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(parsed);
}

/** "TODAY 21:00", "TOMORROW 08:30", "YESTERDAY 22:05", or "TUE, OCT 27". */
export function dayLabel(stamp: unknown, now = Date.now(), tz = TZ): string {
  const day = dayOf(stamp, tz);
  const today = dayOf(new Date(now).toISOString(), tz);
  if (!day || !today) return "—";
  const diff = Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  if (diff === 0) return `TODAY ${clockOf(stamp, tz)}`;
  if (diff === 1) return `TOMORROW ${clockOf(stamp, tz)}`;
  if (diff === -1) return `YESTERDAY ${clockOf(stamp, tz)}`;
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" })
    .format(Date.parse(text(stamp) ?? "")).toUpperCase();
}

export function bytesText(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.round(bytes / 1e6)} MB`;
}

/** "1:05:09" or "4:30". */
export function durationText(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = Math.floor(seconds % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** "2D", "1H 5M", "9M". */
export function etaText(seconds: number | null): string | null {
  if (seconds === null) return null;
  if (seconds >= 86_400) return `${Math.round(seconds / 86_400)}D`;
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}H ${Math.round((seconds % 3600) / 60)}M`;
  return `${Math.max(1, Math.round(seconds / 60))}M`;
}

/** "2D 4H", "3H", "12M". */
export function ageText(ms: number | null): string | null {
  if (ms === null) return null;
  if (ms >= 86_400_000) return `${Math.floor(ms / 86_400_000)}D ${Math.floor((ms % 86_400_000) / 3_600_000)}H`;
  if (ms >= 3_600_000) return `${Math.floor(ms / 3_600_000)}H`;
  return `${Math.max(1, Math.round(ms / 60_000))}M`;
}
