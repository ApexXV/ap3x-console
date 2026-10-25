import { asDict, bytesText, num, record, rows, sinceMs, text } from "../../core/format";
import type { Tone } from "../../core/types";

/* Three contracts feed the media module:
 *  - MA001 workloads (tracker API): download / stalled / import counts and speed;
 *  - AP3X-MEDIA-SESSIONS-1: Plex sessions, *arr queue, schedule, today's counts;
 *  - AP3X-YOUTUBE-ARCHIVE-1: the yt-dlp importers, held retries, the media disk trend. */

export interface Workloads { state: "LIVE" | "PARTIAL" | "STALE" | "UNKNOWN"; downloads: number | null; stalled: number | null; imports: number | null; speed: number | null }

export function parseWorkloads(payload: unknown, now: number): Workloads {
  const w = asDict(payload);
  if (w.contract !== "MA001") return { state: "UNKNOWN", downloads: null, stalled: null, imports: null, speed: null };
  const counts = asDict(w.counts), activity = asDict(w.activity);
  const age = sinceMs(w.generated_at, now);
  const values = { downloads: num(counts.downloads), stalled: num(counts.stalled_downloads), imports: num(counts.import_pending), speed: num(activity.download_speed_bytes) };
  const partial = Object.values(values).some((v) => v === null) || (num(counts.partial_sources) ?? 0) > 0;
  return { state: age === null ? "UNKNOWN" : age > 180_000 ? "STALE" : partial ? "PARTIAL" : "LIVE", ...values };
}

export interface Stream {
  viewer: string; title: string; subtitle: string | null; library: string | null; state: string;
  progress: number | null; duration: number | null; player: string | null; location: string | null; bandwidth: number | null;
  decision: "transcode" | "direct_stream" | "direct_play"; quality: string | null; bitrate: number | null;
  video: { source: string | null; target: string | null; decision: string | null };
  audio: { source: string | null; target: string | null; decision: string | null };
  transcode: { hardware: boolean; speed: number | null; throttled: boolean } | null;
}

export interface QueueItem {
  app: string | null; title: string; subtitle: string | null; stage: string; problem: string | null; progress: number | null;
  eta: number | null; quality: string | null; speed: number | null; seeds: number | null; since: string | null;
}

export interface Dated { app: string | null; title: string; subtitle: string | null; at: string | null; kind: string | null; hasFile: boolean; quality: string | null; library: string | null }

export interface Sessions {
  status: "LIVE" | "STALE"; plexState: string; services: Record<"plex" | "sonarr" | "radarr" | "qbittorrent", string>;
  streams: Stream[]; streamCount: number | null; transcodes: number | null; bandwidth: number | null;
  queue: QueueItem[]; counts: Record<string, number | null>; stuckOverDay: number;
  upcoming: Dated[]; imported: Dated[]; recent: Dated[]; missing: { sonarr: number | null; radarr: number | null };
  today: { imported_episodes: number | null; imported_movies: number | null; watched_titles: number | null; watch_hours: number | null; transcode_sessions: number | null; peak_streams: number | null };
}

const codec = (v: unknown) => { const d = asDict(v); return { source: text(d.source), target: text(d.target), decision: text(d.decision) }; };
const svc = (v: unknown) => (text(asDict(v).state) ?? "UNKNOWN").toUpperCase();

export function parseSessions(payload: unknown, now: number): Sessions | null {
  const feed = asDict(payload);
  if (feed.schema_version !== "AP3X-MEDIA-SESSIONS-1") return null;
  const plex = asDict(feed.plex), counts = asDict(plex.counts), today = asDict(feed.today), qcounts = asDict(feed.counts);
  const decision = (v: unknown): Stream["decision"] => (v === "transcode" || v === "direct_stream" ? v : "direct_play");
  const dated = (u: Record<string, unknown>): Dated => ({
    app: text(u.app), title: text(u.title) ?? "Unknown", subtitle: text(u.subtitle), at: text(u.at, u.added_at),
    kind: text(u.kind), hasFile: u.has_file === true, quality: text(u.quality), library: text(u.library),
  });
  const age = sinceMs(feed.generated_at, now);
  return {
    status: age === null || age > 90_000 ? "STALE" : "LIVE",
    plexState: svc(plex),
    services: { plex: svc(plex), sonarr: svc(feed.sonarr), radarr: svc(feed.radarr), qbittorrent: svc(feed.qbittorrent) },
    streams: rows(plex.sessions).map((s) => ({
      viewer: text(s.viewer) ?? "Viewer", title: text(s.title) ?? "Unknown title", subtitle: text(s.subtitle), library: text(s.library),
      state: text(s.state) ?? "unknown", progress: num(s.progress), duration: num(s.duration_s), player: text(s.player), location: text(s.location),
      bandwidth: num(s.bandwidth_kbps), decision: decision(s.decision), quality: text(s.quality), bitrate: num(s.bitrate_kbps),
      video: codec(s.video), audio: codec(s.audio),
      transcode: record(s.transcode) ? { hardware: s.transcode.hardware === true, speed: num(s.transcode.speed), throttled: s.transcode.throttled === true } : null,
    })),
    streamCount: num(counts.streams), transcodes: num(counts.transcodes), bandwidth: num(plex.bandwidth_kbps),
    queue: rows(feed.queue).map((q) => ({
      app: text(q.app), title: text(q.title) ?? "Unknown", subtitle: text(q.subtitle), stage: text(q.stage) ?? "queued", problem: text(q.problem),
      progress: num(q.progress), eta: num(q.eta_s), quality: text(q.quality), speed: num(q.speed_bps), seeds: num(q.seeds), since: text(q.since),
    })),
    counts: Object.fromEntries(Object.entries(qcounts).map(([k, v]) => [k, num(v)])),
    stuckOverDay: num(qcounts.stuck_over_day) ?? 0,
    upcoming: rows(feed.upcoming).map(dated), imported: rows(feed.imported).map(dated), recent: rows(feed.recently_added).map(dated),
    missing: { sonarr: num(asDict(feed.missing).sonarr), radarr: num(asDict(feed.missing).radarr) },
    today: {
      imported_episodes: num(today.imported_episodes), imported_movies: num(today.imported_movies), watched_titles: num(today.watched_titles),
      watch_hours: num(today.watch_hours), transcode_sessions: num(today.transcode_sessions), peak_streams: num(today.peak_streams),
    },
  };
}

export interface Importer {
  key: string | null; name: string; kind: string | null; phase: string; failure: string | null; holdUntil: string | null; holdReason: string | null;
  note: string | null; done: number | null; total: number | null; unresolved: number | null; lastStarted: string | null; lastEnded: string | null;
  todayAdded: number | null; event: Record<string, unknown> | null;
}

export interface Youtube {
  status: string; importers: Importer[]; running: number; failed: number; held: number;
  freeBytes: number | null; totalBytes: number | null; ratePerDay: number | null; daysToFull: number | null; todayAdded: number; cookie: string | null;
}

export const YT_PHASE: Record<string, [string, Tone]> = {
  idle: ["IDLE", "muted"], held: ["HELD", "warn"], failed: ["STOPPED", "bad"], complete: ["COMPLETE", "good"], unknown: ["UNKNOWN", "muted"],
  running: ["RUNNING", "info"], waiting: ["WAITING", "info"], scanning: ["SCANNING", "info"], probing: ["PROBING", "info"],
  downloading: ["DOWNLOADING", "info"], verifying: ["VERIFYING", "info"], publishing: ["PUBLISHING", "info"],
};
export const isRunning = (phase: string) => YT_PHASE[phase]?.[1] === "info";

export function parseYoutube(payload: unknown, now: number): Youtube | null {
  const feed = asDict(payload);
  if (feed.schema_version !== "AP3X-YOUTUBE-ARCHIVE-1") return null;
  const importers: Importer[] = rows(feed.sources).map((s) => {
    const run = asDict(s.run_status), counts = asDict(s.counts), event = asDict(s.event);
    return {
      key: text(s.key), name: text(s.name) ?? "Importer", kind: text(s.kind), phase: text(s.phase) ?? "unknown",
      failure: text(s.failure), holdUntil: text(s.hold_until), holdReason: text(s.hold_reason), note: text(s.note),
      // A progress total is shown only when the importer itself reported one.
      done: num(event.completed, run.present, counts.records, counts.releases), total: num(event.eligible, run.placements),
      unresolved: num(run.unresolved), lastStarted: text(s.last_started), lastEnded: text(s.last_ended), todayAdded: num(s.today_added),
      event: Object.keys(event).length ? event : null,
    };
  });
  const disk = asDict(feed.disk);
  const age = sinceMs(feed.generated_at, now);
  return {
    status: age === null || age > 180_000 ? "STALE" : (text(feed.systemd) ?? "UNKNOWN").toUpperCase(),
    importers,
    running: importers.filter((s) => isRunning(s.phase)).length,
    failed: importers.filter((s) => s.phase === "failed").length,
    held: importers.filter((s) => s.phase === "held").length,
    freeBytes: num(disk.free_bytes), totalBytes: num(disk.total_bytes), ratePerDay: num(disk.rate_bytes_per_day), daysToFull: num(disk.days_to_full),
    todayAdded: importers.reduce((sum, s) => sum + (s.todayAdded ?? 0), 0), cookie: text(feed.cookie),
  };
}

const FAILURES: Record<string, string> = {
  bot_or_429: "YouTube rate limit (bot check)", network: "Network error", disk_full: "Media disk full", auth: "Cookies need refreshing",
  unavailable: "Video unavailable", lock: "Lock held / already running", low_space: "Below the 1 TiB free-space reserve",
  transient: "Repeated network errors", stopped: "Stopped (see service log)",
};
export const failureText = (code: string | null): string | null =>
  !code ? null : FAILURES[code] ?? (/^exit_(\d+)$/.test(code) ? `Exit code ${code.slice(5)}` : code.replace(/_/g, " "));

export const LOW_DISK_BYTES = 100e9;

/** "bad" under 14 days or 100 GB free, "warn" under 30 days or 5%. */
export function diskStatus(yt: Youtube | null): { tone: Tone; free: string; forecast: string; rate: string | null } | null {
  if (!yt || yt.freeBytes === null) return null;
  const pct = yt.totalBytes ? yt.freeBytes / yt.totalBytes : null;
  const tone: Tone = (yt.daysToFull !== null && yt.daysToFull < 14) || yt.freeBytes < LOW_DISK_BYTES ? "bad"
    : (yt.daysToFull !== null && yt.daysToFull < 30) || (pct !== null && pct < 0.05) ? "warn" : "good";
  const forecast = yt.daysToFull !== null ? `full in ~${yt.daysToFull < 2 ? `${Math.round(yt.daysToFull * 24)} hours` : `${Math.round(yt.daysToFull)} days`}`
    : yt.ratePerDay !== null && yt.ratePerDay >= 0 ? "not shrinking" : "forecast after 12 h of samples";
  return { tone, free: bytesText(yt.freeBytes), forecast, rate: yt.ratePerDay !== null && yt.ratePerDay < 0 ? `${bytesText(-yt.ratePerDay)}/day` : null };
}

/** What would spoil a held retry: the cookie jar's mode, or a disk that will not last until then. */
export function retryWarnings(s: Importer, yt: Youtube | null, now: number): string[] {
  if (s.phase !== "held" || !yt) return [];
  const warnings: string[] = [];
  if (yt.cookie && yt.cookie !== "ok") warnings.push(`cookie jar ${yt.cookie.replace(/_/g, " ")}`);
  const until = Date.parse(s.holdUntil ?? "");
  const wait = Number.isFinite(until) ? until - now : null;
  if (yt.freeBytes !== null && yt.freeBytes < LOW_DISK_BYTES) warnings.push(`media disk only ${bytesText(yt.freeBytes)} free`);
  else if (yt.daysToFull !== null && wait !== null && yt.daysToFull * 86_400_000 < wait + 86_400_000) warnings.push("disk may fill before the retry");
  return warnings;
}
