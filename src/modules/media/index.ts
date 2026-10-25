import { bar, button, el, privateText, setTone, tag } from "../../core/dom";
import { note, paged, place, sec, stats } from "../../core/detail";
import { ageText, bytesText, clockOf, dayLabel, durationText, etaText, sinceMs } from "../../core/format";
import type { ChangeEvent, DetailHooks, ModuleManifest, Tone } from "../../core/types";
import { diskStatus, failureText, isRunning, parseSessions, parseWorkloads, parseYoutube, retryWarnings, YT_PHASE,
  type Dated, type Importer, type QueueItem, type Sessions, type Stream, type Workloads, type Youtube } from "./parse";
import "./media.css";

export interface MediaModel { workloads: Workloads; sessions: Sessions | null; youtube: Youtube | null; streams: number | null; now: number }

const DECISION: Record<Stream["decision"], [string, Tone]> = { transcode: ["TRANSCODE", "warn"], direct_stream: ["DIRECT STREAM", "info"], direct_play: ["DIRECT PLAY", "good"] };
const STAGE: Record<string, [string, Tone]> = {
  downloading: ["DOWNLOADING", "info"], stalled: ["STALLED", "bad"], paused: ["PAUSED", "muted"], queued: ["QUEUED", "muted"], delay: ["DELAYED", "muted"],
  import_pending: ["IMPORT PENDING", "warn"], importing: ["IMPORTING", "info"], import_blocked: ["IMPORT BLOCKED", "bad"], failed: ["FAILED", "bad"], imported: ["IMPORTED", "good"],
};
const STUCK = new Set(["import_blocked", "failed", "stalled", "import_pending"]);
const pad2 = (v: number | null) => (v === null ? "—" : String(Math.round(v)).padStart(2, "0"));

function importerLine(s: Importer, now: number): string {
  if (s.phase === "held") {
    const until = Date.parse(s.holdUntil ?? "");
    const wait = Number.isFinite(until) ? until - now : null;
    const when = /^(TODAY|TOMORROW)/.test(dayLabel(s.holdUntil, now)) ? dayLabel(s.holdUntil, now) : `${dayLabel(s.holdUntil, now)} ${clockOf(s.holdUntil)}`;
    return `Retry ${wait !== null && wait > 0 ? `in ${ageText(wait)} · ` : ""}${when}${s.holdReason ? ` · held after ${failureText(s.holdReason)}` : ""}`;
  }
  if (s.phase === "failed") return `Stopped ${s.lastEnded ? dayLabel(s.lastEnded, now) : ""} · ${failureText(s.failure) ?? "failed"}`;
  if (isRunning(s.phase)) {
    const e = s.event ?? {};
    const n = (k: string) => (typeof e[k] === "number" ? (e[k] as number) : null);
    return [`Running since ${s.lastStarted ? clockOf(s.lastStarted) : "—"}`, n("position") !== null ? `item ${n("position")}` : null,
      n("bytes_downloaded") !== null && n("bytes_total") ? `${bytesText(n("bytes_downloaded"))} / ${bytesText(n("bytes_total"))}` : null,
      n("speed_bytes_per_second") ? `${(n("speed_bytes_per_second")! / 1e6).toFixed(1)} MB/s` : null,
      n("eta_seconds") !== null ? `ETA ${etaText(n("eta_seconds"))}` : null].filter(Boolean).join(" · ");
  }
  return s.lastEnded ? `Last run ended ${dayLabel(s.lastEnded, now)}` : "No run recorded";
}

export function todayText(m: MediaModel): string | null {
  const t = m.sessions?.today;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const parts = [
    t?.imported_episodes != null ? plural(t.imported_episodes, "episode") : null,
    t?.imported_movies != null ? `${plural(t.imported_movies, "movie")} imported` : null,
    t?.watch_hours != null ? `${t.watch_hours} h watched` : null,
    t?.watched_titles ? `${t.watched_titles} finished` : null,
    t?.transcode_sessions != null ? plural(t.transcode_sessions, "transcode") : null,
    t?.peak_streams ? `peak ${plural(t.peak_streams, "stream")}` : null,
    m.youtube ? plural(m.youtube.todayAdded, "YouTube video") : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

function streamCard(s: Stream, hooks: DetailHooks): HTMLElement {
  const open = (hooks.state.open as Set<string> | undefined) ?? new Set<string>();
  hooks.state.open = open;
  const key = `${s.viewer}|${s.title}|${s.subtitle}`;
  const [label, tone] = DECISION[s.decision];
  const li = el("li", `stream${open.has(key) ? " is-open" : ""}`);
  setTone(li, tone);
  const copy = el("div", "mcopy");
  copy.append(el("b", "", s.title), el("small", "", [s.subtitle, s.library].filter(Boolean).join(" · ") || "—"));
  const head = el("div", "mhead");
  head.append(privateText(el("span", "viewer", s.viewer)), copy, el("span", "mstate", s.state === "paused" ? "❚❚" : s.state === "buffering" ? "…" : "▶"),
    tag(label, tone), el("span", "mcaret", open.has(key) ? "▴" : "▾"));
  const position = s.progress !== null && s.duration ? s.progress * s.duration : null;
  const progress = el("div", "mprogress");
  progress.append(bar(s.progress ?? 0, tone), el("span", "", `${durationText(position)} / ${durationText(s.duration)}`));
  li.append(head, progress);
  if (open.has(key)) {
    const codec = (c: Stream["video"]) => [c.source?.toUpperCase(), c.target && c.target !== c.source ? `→ ${c.target.toUpperCase()}` : null, c.decision ? `(${c.decision})` : null].filter(Boolean).join(" ") || "—";
    const t = s.transcode;
    const facts = el("div", "facts");
    for (const [k, v] of [
      ["PLAYER", s.player ?? "—"], ["CONNECTION", s.location === "remote" ? "REMOTE" : s.location === "lan" ? "LAN" : "—"],
      ["QUALITY", [s.quality, s.bitrate ? `${(s.bitrate / 1000).toFixed(1)} Mbps` : null].filter(Boolean).join(" · ") || "—"],
      ["BANDWIDTH", s.bandwidth ? `${(s.bandwidth / 1000).toFixed(1)} Mbps` : "—"], ["VIDEO", codec(s.video)], ["AUDIO", codec(s.audio)],
      ["TRANSCODER", t ? [t.hardware ? "HARDWARE" : "CPU", t.speed !== null ? `${t.speed}×` : null, t.throttled ? "THROTTLED" : null].filter(Boolean).join(" · ") : "NOT TRANSCODING"],
      ["STATE", s.state.toUpperCase()],
    ] as const) {
      const cell = el("div");
      cell.append(el("span", "", k), el("b", "", v));
      facts.append(cell);
    }
    li.append(facts);
  }
  li.addEventListener("click", (event) => {
    event.stopPropagation();
    if (open.has(key)) open.delete(key); else open.add(key);
    hooks.rebuild();
  });
  return li;
}

function queueRow(q: QueueItem, now: number): HTMLElement {
  const [baseLabel, baseTone] = STAGE[q.stage] ?? ["QUEUED", "muted"];
  const age = STUCK.has(q.stage) ? sinceMs(q.since, now) : null;
  const label = age !== null && age >= 3_600_000 ? `${baseLabel} · ${ageText(age)}` : baseLabel;
  const tone: Tone = age !== null && age >= 86_400_000 ? "bad" : baseTone;
  const li = el("li", "qrow");
  setTone(li, tone);
  const copy = el("div", "mcopy");
  const sub = el("small", "", q.problem ?? ([q.subtitle, q.quality, q.app?.toUpperCase()].filter(Boolean).join(" · ") || "—"));
  if (q.problem) setTone(sub, tone), sub.classList.add("is-problem");
  copy.append(el("b", "", q.title), sub);
  const meter = el("div", "meter");
  meter.append(bar(q.progress ?? 0, tone), el("span", "", [q.progress !== null ? `${Math.round(q.progress * 100)}%` : null,
    q.speed ? `${(q.speed / 1e6).toFixed(1)} MB/s` : null, etaText(q.eta) ? `ETA ${etaText(q.eta)}` : null,
    q.seeds !== null && q.stage === "stalled" ? `${q.seeds} SEEDS` : null].filter(Boolean).join(" · ") || "—"));
  li.append(copy, meter, tag(label, tone));
  return li;
}

function importerRow(s: Importer, yt: Youtube, now: number): HTMLElement {
  const [label, tone] = YT_PHASE[s.phase] ?? YT_PHASE.unknown!;
  const li = el("li", "qrow");
  setTone(li, tone);
  const copy = el("div", "mcopy");
  copy.append(el("b", "", s.name), el("small", "", [importerLine(s, now), s.todayAdded ? `+${s.todayAdded} today` : null, s.note].filter(Boolean).join(" · ")));
  const warnings = retryWarnings(s, yt, now);
  if (warnings.length) {
    const warn = el("small", "is-problem", `⚠ ${warnings.join(" · ")}`);
    setTone(warn, "bad");
    copy.append(warn);
  }
  const meter = el("div", "meter");
  meter.append(s.total ? bar((s.done ?? 0) / s.total, tone) : el("span", "dbar is-empty"),
    el("span", "", s.total ? `${s.done ?? 0} / ${s.total}${s.unresolved ? ` · ${s.unresolved} LEFT` : ""}` : s.done !== null ? `${s.done} ${s.kind === "artist" ? "RELEASES" : "SAVED"}` : "—"));
  li.append(copy, meter, tag(label, tone));
  return li;
}

function datedRow(u: Dated, kind: string, now: number): HTMLElement {
  const li = el("li", "drow");
  setTone(li, kind === "upcoming" && !u.hasFile ? "info" : "good");
  const copy = el("div", "mcopy");
  copy.append(el("b", "", u.title), el("small", "", [u.subtitle, u.quality, u.library].filter(Boolean).join(" · ") || "—"));
  const label = kind === "upcoming" ? (u.hasFile ? "ON PLEX" : (u.kind ?? u.app ?? "").toUpperCase()) : kind === "imported" ? (u.app ?? "").toUpperCase() : "PLEX";
  li.append(el("span", "dwhen", dayLabel(u.at, now)), copy, tag(label, kind === "upcoming" && !u.hasFile ? "info" : "good"));
  return li;
}

const chipFor = (m: MediaModel): { label: string; tone: Tone } => {
  const w = m.workloads;
  const attention = (w.stalled ?? 0) > 0 || (w.imports ?? 0) > 0;
  return w.state === "UNKNOWN" ? { label: "SOURCE UNKNOWN", tone: "muted" }
    : { label: attention ? `ATTENTION · ${w.state}` : `MEDIA ${w.state}`, tone: attention || w.state !== "LIVE" ? "warn" : "good" };
};

export const mediaModule: ModuleManifest<MediaModel> = {
  id: "media",
  title: "MEDIA PIPELINE",
  description: "Downloads and imports, Plex streams with transcode detail, the YouTube archive, the 7-day schedule, and the media disk forecast.",
  version: "1.0.0",
  sources: [
    { id: "workloads", url: "/api/ops/workloads", stampField: "generated_at", maxAgeMs: 5 * 60_000 },
    { id: "media-sessions", url: "/media-sessions-data/current.json", schema: "AP3X-MEDIA-SESSIONS-1", stampField: "generated_at", maxAgeMs: 2 * 60_000 },
    { id: "youtube", url: "/youtube-archive-data/current.json", schema: "AP3X-YOUTUBE-ARCHIVE-1", stampField: "generated_at", maxAgeMs: 3 * 60_000 },
  ],

  model(ctx) {
    const workloads = parseWorkloads(ctx.sources.workloads?.data, ctx.now);
    const sessions = parseSessions(ctx.sources["media-sessions"]?.data, ctx.now);
    const youtube = parseYoutube(ctx.sources.youtube?.data, ctx.now);
    const streams = sessions?.status === "LIVE" && sessions.plexState === "LIVE" ? sessions.streamCount : null;
    return { workloads, sessions, youtube, streams, now: ctx.now };
  },

  render(body, m) {
    const counters = el("div", "counters");
    const counter = (value: number | null, label: string, tone?: Tone) => {
      const cell = el("div");
      const b = el("b", "", pad2(value));
      if (tone) b.classList.add(`t-${tone}`);
      cell.append(b, el("span", "", label));
      return cell;
    };
    counters.append(counter(m.workloads.downloads, "DOWNLOADING"), counter(m.workloads.stalled, "STALLED", m.workloads.stalled ? "bad" : undefined),
      counter(m.workloads.imports, "IMPORTS"), counter(m.streams, "STREAMS"));
    const flow = el("div", "flowline");
    flow.style.setProperty("--flow", m.workloads.speed ? "1" : "0");
    flow.append(el("span"));
    const now = el("div", "media-line");
    const playing = m.sessions?.streams ?? [];
    const first = playing[0];
    if (!m.sessions) now.append(el("span", "", "▶ PLEX · session detail not installed"));
    else if (!first) now.append(el("span", "", "▶ NOTHING PLAYING"));
    else {
      now.append(el("span", "", "▶ "), privateText(el("b", "", first.viewer)), el("span", "", ` ${first.title}${first.subtitle ? ` · ${first.subtitle}` : ""}`),
        el("em", "", `${DECISION[first.decision][0]}${playing.length > 1 ? ` · +${playing.length - 1} MORE` : ""}${m.sessions.transcodes ? ` · ${m.sessions.transcodes} TRANSCODING` : ""}`));
    }
    const yt = m.youtube;
    const focus = yt?.importers.find((s) => isRunning(s.phase)) ?? yt?.importers.find((s) => s.phase === "failed") ?? yt?.importers.find((s) => s.phase === "held");
    const ytLine = el("div", "media-line media-yt");
    ytLine.dataset.tone = !yt ? "muted" : yt.failed ? "bad" : yt.held ? "warn" : yt.running ? "info" : "good";
    ytLine.textContent = !yt ? "YOUTUBE ARCHIVE · status not installed"
      : `YOUTUBE · ${focus ? `${focus.name} ${focus.total ? `${focus.done ?? 0}/${focus.total} ` : ""}${(YT_PHASE[focus.phase] ?? YT_PHASE.unknown!)[0]}${
        focus.phase === "held" ? ` · retry in ${ageText(Math.max(0, Date.parse(focus.holdUntil ?? "") - m.now) || 0)}${retryWarnings(focus, yt, m.now).length ? " · ⚠" : ""}`
          : focus.phase === "failed" ? ` · ${failureText(focus.failure)}` : ""}` : `${yt.importers.length} importers idle`}${yt.status === "STALE" ? " · STALE" : ""}`;
    body.replaceChildren(counters, flow, now, ytLine);
  },

  chip: chipFor,

  detail(m, ctx, hooks) {
    const { workloads: w, sessions: ms, youtube: yt } = m;
    const small = ctx.stageWidth < 4000;
    const perPage = small ? 4 : 5;
    const disk = diskStatus(yt);
    const head = place(stats([
      ["DOWNLOADING", w.downloads], ["STALLED", w.stalled, w.stalled ? "bad" : "good"], ["IMPORTS PENDING", w.imports, w.imports ? "warn" : "good"],
      ["IMPORT BLOCKED", ms?.counts.import_blocked ?? null, ms?.counts.import_blocked ? "bad" : "good", ms?.stuckOverDay ? `${ms.stuckOverDay} STUCK OVER 1 DAY` : null],
      ["STREAMS", ms?.streamCount ?? m.streams, "info", [ms?.transcodes ? `${ms.transcodes} TRANSCODING` : null, ms?.bandwidth ? `${(ms.bandwidth / 1000).toFixed(1)} Mbps` : null].filter(Boolean).join(" · ") || null],
      ["MEDIA DISK", disk ? `${disk.free} FREE` : null, disk?.tone, disk ? [disk.forecast, disk.rate].filter(Boolean).join(" · ") : null],
      ["DOWNLOAD", w.speed ? `${(w.speed / 1_000_000).toFixed(1)} MB/s` : "IDLE"],
      ["YOUTUBE", yt ? (yt.running ? `${yt.running} RUNNING` : yt.failed ? `${yt.failed} STOPPED` : yt.held ? `${yt.held} HELD` : "IDLE") : null,
        yt?.failed ? "bad" : yt?.held ? "warn" : yt?.running ? "info" : "good"],
    ], 8), "1 / -1");

    const streams = ms?.streams ?? [];
    const playing = place(sec(`NOW PLAYING${ms ? ` · PLEX ${ms.plexState}` : ""}`,
      ...(ms ? (streams.length ? paged(hooks.state, "streams", streams, perPage - 1, (s) => streamCard(s, hooks), hooks.rebuild) : [note("Nothing is playing on Plex right now.")])
        : [note("Plex session detail needs the media-sessions collector (ap3x-wall-data-collectors).")]),
      ms && streams.length ? note("Click a stream for codecs, bandwidth and transcoder detail.") : null), "1", "2");

    const queue = ms?.queue ?? [];
    const downloads = place(sec(`DOWNLOADS & IMPORTS${ms ? ` · SONARR ${ms.services.sonarr} · RADARR ${ms.services.radarr} · QBIT ${ms.services.qbittorrent}` : ""}`,
      ...(ms ? (queue.length ? paged(hooks.state, "queue", queue, perPage + 1, (q) => queueRow(q, m.now), hooks.rebuild) : [note("Sonarr and Radarr queues are empty.")])
        : [note(`MA001 workloads: ${w.state.toLowerCase()}`)])), "2", "2");

    const ytList = el("ol", "mlist");
    if (yt) ytList.append(...yt.importers.map((s) => importerRow(s, yt, m.now)));
    const archive = place(sec("YOUTUBE ARCHIVE · YT-DLP",
      ...(yt ? [ytList, note([`Media disk ${bytesText(yt.freeBytes)} free${disk ? ` (${disk.forecast})` : ""}`,
        `cookie jar ${yt.cookie === "ok" ? "OK" : (yt.cookie ?? "unknown").replace(/_/g, " ").toUpperCase()}`,
        yt.status === "STALE" ? "STATUS STALE" : null, "read-only view · importers run on their own schedule"].filter(Boolean).join(" · "))]
        : [note("YouTube importer status needs the youtube-archive collector (ap3x-wall-data-collectors).")])), "1", "3");

    const lists: Record<string, Dated[]> = { upcoming: ms?.upcoming ?? [], imported: ms?.imported ?? [], recent: ms?.recent ?? [] };
    const tab = String(hooks.state.tab ?? "upcoming");
    const tabs = el("div", "tabs");
    for (const [key, label] of [["upcoming", "COMING UP · 7 DAYS"], ["imported", "RECENTLY IMPORTED"], ["recent", "ADDED TO PLEX"]] as const) {
      const b = button(`${label} · ${lists[key]!.length}`, label, () => { hooks.state.tab = key; hooks.rebuild(); }, `btn${tab === key ? " is-active" : ""}`);
      tabs.append(b);
    }
    const missing = [ms?.missing.sonarr ?? null, ms?.missing.radarr ?? null];
    const schedule = place(sec(null, tabs,
      ...(lists[tab]!.length ? paged(hooks.state, `dated-${tab}`, lists[tab]!, perPage + 1, (u) => datedRow(u, tab, m.now), hooks.rebuild)
        : [note(ms ? "Nothing to show." : "Needs the media-sessions collector.")]),
      missing.some((v) => v) ? note(`Monitored but missing: ${missing[0] ?? "—"} episodes · ${missing[1] ?? "—"} movies`) : null), "2", "3");

    const today = todayText(m);
    return {
      title: "MEDIA PIPELINE", chip: chipFor(m),
      foot: `${today ? `TODAY · ${today} · ` : ""}Observational only · no unattended deletion, repair, or importer starts`,
      columns: "minmax(0, 1fr) minmax(0, 1fr)", rows: "auto minmax(0, 1.1fr) minmax(0, 1fr)",
      sections: [head, playing, downloads, archive, schedule],
    };
  },

  changes(a, b) {
    const events: ChangeEvent[] = [];
    for (const s of b.youtube?.importers ?? []) {
      const before = a.youtube?.importers.find((x) => x.key === s.key);
      if (!before || before.phase === s.phase) continue;
      if (s.phase === "failed") events.push({ tone: "bad", kicker: "YOUTUBE ARCHIVE", text: `${s.name} stopped · ${failureText(s.failure) ?? "failed"}` });
      else if (s.phase === "complete") events.push({ tone: "good", kicker: "YOUTUBE ARCHIVE", text: `${s.name} finished` });
      else if (isRunning(s.phase) && !isRunning(before.phase)) events.push({ tone: "info", kicker: "YOUTUBE ARCHIVE", text: `${s.name} started` });
    }
    const stuck = (m: MediaModel) => m.sessions?.stuckOverDay ?? 0;
    if (a.sessions && b.sessions && stuck(b) > stuck(a)) events.push({ tone: "warn", kicker: "MEDIA STUCK", text: `${stuck(b)} download${stuck(b) === 1 ? "" : "s"} stuck over a day` });
    const blocked = (m: MediaModel) => m.sessions?.counts.import_blocked ?? 0;
    if (a.sessions && b.sessions && blocked(b) > blocked(a)) events.push({ tone: "warn", kicker: "MEDIA IMPORT", text: `${blocked(b)} import${blocked(b) === 1 ? "" : "s"} blocked in Sonarr/Radarr` });
    const da = diskStatus(a.youtube), db = diskStatus(b.youtube);
    if (da && db && da.tone !== db.tone && db.tone !== "good") events.push({ tone: db.tone === "bad" ? "bad" : "warn", kicker: "MEDIA DISK", text: `${db.free} free · ${db.forecast}` });
    if (a.youtube?.cookie === "ok" && b.youtube && b.youtube.cookie !== "ok") events.push({ tone: "bad", kicker: "YOUTUBE ARCHIVE", text: `Cookie jar ${String(b.youtube.cookie).replace(/_/g, " ")}` });
    return events;
  },

  priority(m) {
    const disk = diskStatus(m.youtube);
    if (disk?.tone === "bad") {
      return { rank: 50, kicker: "MEDIA / STORAGE", title: `Media disk ${disk.free} free`, summary: `${disk.forecast}${disk.rate ? ` at ${disk.rate}` : ""} · downloads and the YouTube archive share this disk`, posture: "WARNING", tone: "bad" };
    }
    if ((m.workloads.stalled ?? 0) > 0) {
      return { rank: 20, kicker: "MEDIA / REVIEW", title: `${m.workloads.stalled} stalled download${m.workloads.stalled === 1 ? "" : "s"}`, summary: "Automation remains observational; no unattended repair.", posture: "WATCH", tone: "warn" };
    }
    return null;
  },

  demo(now) {
    const at = (hours: number) => new Date(now + hours * 3_600_000).toISOString();
    return {
      workloads: { contract: "MA001", generated_at: at(0), counts: { downloads: 3, stalled_downloads: 0, import_pending: 2, partial_sources: 0 }, activity: { download_speed_bytes: 18_400_000 } },
      "media-sessions": {
        schema_version: "AP3X-MEDIA-SESSIONS-1", generated_at: at(0),
        plex: { state: "LIVE", bandwidth_kbps: 21_400, counts: { streams: 2, transcodes: 1, remote: 1 }, sessions: [
          { viewer: "SM", title: "The Expanse", subtitle: "S02E03 · Static", library: "TV Shows", type: "episode", state: "playing", progress: 0.42, duration_s: 2700,
            player: "Plex Web · Chrome", location: "remote", bandwidth_kbps: 8200, decision: "transcode", quality: "1080P", bitrate_kbps: 9400,
            video: { source: "hevc", target: "h264", decision: "transcode" }, audio: { source: "eac3", target: "eac3", decision: "copy" }, transcode: { hardware: true, speed: 2.4, throttled: true } },
          { viewer: "Mom", title: "Dune: Part Two", subtitle: "2024", library: "Movies", type: "movie", state: "paused", progress: 0.71, duration_s: 9960,
            player: "Plex for Roku · Roku", location: "lan", bandwidth_kbps: 13_200, decision: "direct_play", quality: "4K", bitrate_kbps: 22_000,
            video: { source: "hevc", decision: "directplay" }, audio: { source: "truehd", decision: "directplay" } },
        ] },
        sonarr: { state: "LIVE" }, radarr: { state: "LIVE" }, qbittorrent: { state: "LIVE" },
        queue: [
          { app: "sonarr", title: "Andor", subtitle: "S02E04 · Harvest", stage: "import_blocked", problem: "No matching series or episode", progress: 1, since: at(-52) },
          { app: "sonarr", title: "Slow Horses", subtitle: "S05E01", stage: "downloading", progress: 0.63, eta_s: 540, quality: "WEBDL-1080p", speed_bps: 12_400_000, since: at(-0.5) },
          { app: "radarr", title: "Sinners", subtitle: "2025", stage: "downloading", progress: 0.18, eta_s: 2280, quality: "Bluray-2160p", speed_bps: 6_000_000 },
          { app: "radarr", title: "Weapons", subtitle: "2025", stage: "import_pending", progress: 1, quality: "WEBDL-1080p" },
        ],
        counts: { queue: 4, downloading: 2, stalled: 0, import_pending: 1, import_blocked: 1, stuck_over_day: 1 },
        today: { imported_episodes: 6, imported_movies: 2, watched_titles: 3, watch_hours: 3.1, transcode_sessions: 1, peak_streams: 2 },
        upcoming: [
          { app: "sonarr", title: "The Diplomat", subtitle: "S03E04 · Dead Reckoning", at: at(1.5), kind: "airs" },
          { app: "sonarr", title: "Slow Horses", subtitle: "S05E02", at: at(26), kind: "airs" },
          { app: "radarr", title: "One Battle After Another", subtitle: "2025", at: at(70), kind: "digital" },
        ],
        imported: [{ app: "sonarr", title: "Andor", subtitle: "S02E03 · Harvest", at: at(-3), quality: "WEBDL-1080p" }],
        recently_added: [{ title: "Andor", subtitle: "Season 2", library: "TV Shows", added_at: at(-3) }],
        missing: { sonarr: 7, radarr: 2 },
      },
      youtube: {
        schema_version: "AP3X-YOUTUBE-ARCHIVE-1", generated_at: at(0), systemd: "LIVE", cookie: "ok",
        disk: { free_bytes: 3.4e12, total_bytes: 60e12, rate_bytes_per_day: -48e9, days_to_full: 70.8 },
        sources: [
          { key: "mianite", name: "Mianite streams", kind: "video", phase: "held", failure: "bot_or_429", hold_until: at(60), hold_reason: "bot_or_429",
            run_status: { present: 12, placements: 25, unresolved: 13 }, counts: { records: 12, pending: 0 }, last_ended: at(-14), note: "Cautious retry Wed 12:00 ET", today_added: 0 },
          { key: "channels", name: "Creator videos", kind: "video", phase: "idle", counts: { records: 267 }, last_ended: at(-30), note: "JJtCool: 267 kept, 7 skipped by owner" },
          { key: "playlists", name: "Curated playlists", kind: "video", phase: "downloading", counts: { records: 41 }, last_started: at(-0.2), today_added: 3,
            event: { phase: "downloading", position: 42, eligible: 60, completed: 41, bytes_downloaded: 380e6, bytes_total: 910e6, speed_bytes_per_second: 4.2e6, eta_seconds: 126 } },
          { key: "artist", name: "Artist albums", kind: "artist", phase: "idle", timer: "disabled", counts: { releases: 38 }, note: "Daily timer deliberately disabled" },
        ],
      },
    };
  },
};
