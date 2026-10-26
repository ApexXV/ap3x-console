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

/* Clock style for every time the console shows: "18:07" (24h, the default) or "6:07 PM" (12h).
 * A layout picks it with `clock`; the console sets it once at mount. */
let hours: "12h" | "24h" = "24h";
export function setClockFormat(format: "12h" | "24h"): void { hours = format; }
export const clockFormat = (): "12h" | "24h" => hours;

const timeParts = (seconds: boolean, tz: string): Intl.DateTimeFormatOptions => (hours === "12h"
  ? { timeZone: tz, hour: "numeric", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}), hour12: true }
  : { timeZone: tz, hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}), hourCycle: "h23" });

export function clockOf(stamp: unknown, tz = TZ): string {
  const parsed = Date.parse(text(stamp) ?? "");
  if (!Number.isFinite(parsed)) return "--:--";
  return new Intl.DateTimeFormat("en-US", timeParts(false, tz)).format(parsed);
}

/** clockOf with seconds ("18:07:33" or "6:07:33 PM"). */
export function clockWithSeconds(stamp: unknown, tz = TZ): string {
  const parsed = Date.parse(text(stamp) ?? "");
  if (!Number.isFinite(parsed)) return "--:--:--";
  return new Intl.DateTimeFormat("en-US", timeParts(true, tz)).format(parsed);
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

/** First non-empty value at any of the dotted paths, e.g. pick(status, ["system.cpu_percent", "cpu_percent"]). */
export function pick(root: unknown, paths: string[]): unknown {
  for (const path of paths) {
    let current: unknown = root;
    let found = true;
    for (const part of path.split(".")) {
      if (!record(current) || !(part in current)) { found = false; break; }
      current = current[part];
    }
    if (found && current !== undefined && current !== null && current !== "") return current;
  }
  return null;
}

export function bool(...values: unknown[]): boolean | null {
  for (const value of values) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const v = value.trim().toLowerCase();
      if (["true", "online", "active", "healthy", "up", "running", "ready", "live"].includes(v)) return true;
      if (["false", "offline", "inactive", "down", "failed", "stopped", "dead"].includes(v)) return false;
    }
  }
  return null;
}

/** A tone for a free-form state word reported by a service ("DEGRADED" → warn, "HEALTHY" → good). */
export function toneFor(value: unknown): "good" | "warn" | "bad" | "info" | "muted" {
  const state = String(value ?? "UNKNOWN").toUpperCase();
  if (/FAILED|FAIL|OFFLINE|DOWN|ERROR|CRITICAL|SEVERE|EMERGENCY|OVERDUE/.test(state)) return "bad";
  if (/WARN|WATCH|REVIEW|STALE|PARTIAL|DEGRADED|PENDING|ATTENTION|RETAINED|UPDATE/.test(state)) return "warn";
  if (/INFO|LOCAL|CONNECTED|LINKED|DEMO/.test(state)) return "info";
  if (/LIVE|ONLINE|UP|ACTIVE|HEALTHY|GOOD|READY|CURRENT|NOMINAL|CLEAR|PASS|IDLE|GREEN|RUNNING|CALM/.test(state)) return "good";
  return "muted";
}

/** "JUST NOW", "12M AGO", "3H AGO", "2D AGO". */
export function ageLabel(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "UNKNOWN";
  if (ms < 60_000) return "JUST NOW";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}M AGO`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}H AGO`;
  return `${Math.floor(ms / 86_400_000)}D AGO`;
}

/** Whole days from today (in the console's time zone) to a YYYY-MM-DD date. */
export function daysUntil(due: string | null, now = Date.now(), tz = TZ): number | null {
  if (!due || !/^\d{4}-\d{2}-\d{2}$/.test(due)) return null;
  const today = dayOf(new Date(now).toISOString(), tz);
  const days = Math.round((Date.parse(`${due}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  return Number.isFinite(days) ? days : null;
}

export function dueLabel(days: number | null): string {
  if (days === null) return "NO DATE";
  if (days < 0) return `${Math.abs(days)}D OVERDUE`;
  if (days === 0) return "DUE TODAY";
  if (days === 1) return "TOMORROW";
  return `IN ${days}D`;
}

export const dueTone = (days: number | null): "bad" | "warn" | "info" | "muted" => (days === null ? "muted" : days < 0 ? "bad" : days <= 7 ? "warn" : "info");

/** "$1,234.56" (or "$1,235" with digits = 0); "—" when unknown. */
export function money(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** "+$12.00", "−$3", "$0.00". */
export const signedMoney = (value: number | null | undefined, digits = 2): string =>
  value === null || value === undefined || !Number.isFinite(value) ? "—" : `${value > 0 ? "+" : value < 0 ? "−" : ""}${money(Math.abs(value), digits)}`;

export const signedPct = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value) ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
