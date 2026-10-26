import { el, setTone } from "../../core/dom";
import { dlist, note, place, sec, stats } from "../../core/detail";
import { clockOf, num, pick, rows, text, toneFor } from "../../core/format";
import type { ModuleManifest } from "../../core/types";

/* The threat contract (level, score, drivers, trend) and the tracker's operations feed. */

export interface ThreatModel {
  level: string; score: number | null; trend: string; drivers: string[];
  feed: { time: string; text: string; state: string }[];
}

export function parseThreat(threat: unknown, opsFeed: unknown): ThreatModel {
  const driversValue = pick(threat, ["drivers", "threat_drivers", "active_drivers", "threat.drivers"]);
  const drivers = Array.isArray(driversValue) ? driversValue.map((d) => text(d)).filter((d): d is string => Boolean(d)) : text(driversValue) ? [text(driversValue)!] : [];
  const feedRows = rows(Array.isArray(opsFeed) ? opsFeed : pick(opsFeed, ["items", "events", "feed", "entries", "data.items"])).slice(0, 14);
  return {
    level: (text(pick(threat, ["level", "state", "status", "posture", "threat.level"])) ?? "UNKNOWN").toUpperCase(),
    score: num(pick(threat, ["score", "threat_score", "threat.score"])),
    trend: (text(pick(threat, ["trend", "direction", "threat.trend"])) ?? "UNKNOWN").toUpperCase(),
    drivers,
    feed: feedRows.map((row) => ({
      time: clockOf(text(row.timestamp, row.created_at, row.observed_at, row.time)),
      text: text(row.summary, row.message, row.title, row.event) ?? "Feed event",
      state: (text(row.state, row.status, row.level, row.severity) ?? "INFO").toUpperCase(),
    })),
  };
}

const levelTone = (level: string) => (level === "LOW" ? "good" : toneFor(level));

export const threatModule: ModuleManifest<ThreatModel, { rows: number }> = {
  id: "threat",
  title: "THREAT & OPS FEED",
  description: "Threat level, drivers, and trend, with the latest operations feed events.",
  version: "1.0.0",
  defaults: { rows: 4 },
  sources: [{ id: "threat", url: "/api/threat" }, { id: "ops-feed", url: "/api/ops/feed" }],

  model: (ctx) => parseThreat(ctx.sources.threat?.data, ctx.sources["ops-feed"]?.data),

  render(body, t, ctx) {
    const line = el("div", "threat-line");
    line.append(el("span", "kicker", "DRIVERS"), el("b", "", t.level === "UNKNOWN" ? "UNKNOWN" : t.drivers.length ? t.drivers.slice(0, 2).join(" / ") : "NONE"),
      el("span", "kicker", "TREND"), el("b", "", t.trend));
    const feed = el("ol", "ops-feed");
    feed.append(...t.feed.slice(0, ctx.settings.rows).map((f) => {
      const li = el("li");
      setTone(li, toneFor(f.state));
      li.append(el("time", "", f.time), el("span", "", f.text), el("em", "", f.state));
      return li;
    }));
    body.replaceChildren(line, t.feed.length ? feed : el("p", "empty", "No current feed events"));
  },

  ticker: (t) => t.feed.slice(0, 4).map((f) => ({ label: f.time, value: f.text, order: 40 })),

  chip: (t) => ({ label: `${t.level}${t.score === null ? "" : ` · ${t.score}`}`, tone: levelTone(t.level) }),

  detail(t) {
    return {
      title: "THREAT & OPERATIONS FEED", chip: this.chip!(t), foot: "Threat contract and tracker operations feed",
      columns: "minmax(0, 1fr) minmax(0, 2fr)", rows: "auto minmax(0, 1fr)",
      sections: [
        place(stats([["LEVEL", t.level, levelTone(t.level)], ["SCORE", t.score], ["TREND", t.trend], ["DRIVERS", t.drivers.length]], 4), "1 / -1"),
        sec("ACTIVE DRIVERS", t.drivers.length ? dlist(t.drivers.map((d) => ({ title: d, tag: "ACTIVE", tone: "warn" }))) : note("No active threat drivers reported.")),
        sec("OPERATIONS FEED", t.feed.length ? dlist(t.feed.map((f) => ({ title: f.text, detail: f.time, tag: f.state, tone: toneFor(f.state) }))) : note("No current feed events.")),
      ],
    };
  },

  priority: (t) => (["HIGH", "SEVERE", "CRITICAL", "ELEVATED"].includes(t.level)
    ? { rank: 65, kicker: "THREAT / LEVEL", title: `Threat level ${t.level}${t.score === null ? "" : ` · ${t.score}`}`, summary: t.drivers.slice(0, 3).join(" · ") || "No drivers reported", posture: t.level, tone: "bad" } : null),

  demo(now) {
    const at = (min: number) => new Date(now - min * 60_000).toISOString();
    return {
      threat: { level: "LOW", score: 18, drivers: [], trend: "STEADY" },
      "ops-feed": { items: [
        { timestamp: at(8), summary: "Ledger synchronizer published a validated snapshot", state: "INFO" },
        { timestamp: at(20), summary: "Market Sentinel scan complete · 8/8 quotes fresh", state: "LIVE" },
        { timestamp: at(35), summary: "Plex direct play session started", state: "INFO" },
        { timestamp: at(52), summary: "Sonarr import queued for review", state: "WATCH" },
      ] },
    };
  },
};
