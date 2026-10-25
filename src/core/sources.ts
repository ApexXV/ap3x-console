import type { SourceSpec, SourceState } from "./types";

type Fetcher = (url: string) => Promise<unknown>;

const RETAIN_MS = 10 * 60_000;

export async function fetchJson(url: string, timeoutMs = 8_000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { cache: "no-store", credentials: "same-origin", signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export function stampAge(data: unknown, field: string | undefined, now: number): number | null {
  if (!field || !data || typeof data !== "object") return null;
  const value = (data as Record<string, unknown>)[field];
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? Math.max(0, now - parsed) : null;
}

/**
 * Fetches every registered source once per refresh, keeps the last good payload
 * for ten minutes when a fetch fails, and classifies each source as ok,
 * retained, stale (its own timestamp is older than maxAgeMs), down, or unknown.
 */
export class SourceHub {
  private specs = new Map<string, SourceSpec>();
  private cache = new Map<string, { data: unknown; at: number }>();
  private seen = new Set<string>();

  constructor(
    private fetcher: Fetcher = fetchJson,
    private clock: () => number = Date.now,
    private retainMs = RETAIN_MS,
  ) {}

  register(spec: SourceSpec): void {
    const existing = this.specs.get(spec.id);
    if (existing && existing.url !== spec.url) {
      throw new Error(`source "${spec.id}" is declared with two URLs: ${existing.url} and ${spec.url}`);
    }
    // The strictest declaration wins when modules share a feed.
    const maxAgeMs = Math.min(existing?.maxAgeMs ?? Infinity, spec.maxAgeMs ?? Infinity);
    this.specs.set(spec.id, {
      ...existing, ...spec,
      maxAgeMs: Number.isFinite(maxAgeMs) ? maxAgeMs : undefined,
      optional: (existing?.optional ?? true) && (spec.optional ?? false),
    });
  }

  get ids(): string[] {
    return [...this.specs.keys()];
  }

  async refresh(): Promise<Record<string, SourceState>> {
    const entries = await Promise.all([...this.specs.values()].map(async (spec) => [spec.id, await this.fetchOne(spec)] as const));
    return Object.fromEntries(entries);
  }

  /** Demo mode: classify fixed payloads exactly as live ones would be. */
  fromPayloads(payloads: Record<string, unknown>): Record<string, SourceState> {
    const now = this.clock();
    return Object.fromEntries([...this.specs.values()].map((spec) => {
      const data = payloads[spec.id];
      return [spec.id, data === undefined
        ? { id: spec.id, status: "unknown", data: null, ageMs: null, fetchedAt: null, seen: false }
        : this.classify(spec, data, now, now, false)];
    }));
  }

  private async fetchOne(spec: SourceSpec): Promise<SourceState> {
    const now = this.clock();
    try {
      const data = await this.fetcher(spec.url);
      this.cache.set(spec.id, { data, at: now });
      this.seen.add(spec.id);
      return this.classify(spec, data, now, now, false);
    } catch {
      const cached = this.cache.get(spec.id);
      if (cached && now - cached.at <= this.retainMs) return this.classify(spec, cached.data, cached.at, now, true);
      const status = spec.optional && !this.seen.has(spec.id) ? "unknown" : "down";
      return { id: spec.id, status, data: null, ageMs: null, fetchedAt: cached?.at ?? null, seen: this.seen.has(spec.id) };
    }
  }

  private classify(spec: SourceSpec, data: unknown, fetchedAt: number, now: number, retained: boolean): SourceState {
    const ageMs = stampAge(data, spec.stampField, now);
    const stale = spec.maxAgeMs !== undefined && ageMs !== null && ageMs > spec.maxAgeMs;
    return { id: spec.id, status: stale ? "stale" : retained ? "retained" : "ok", data, ageMs, fetchedAt, seen: true };
  }
}
