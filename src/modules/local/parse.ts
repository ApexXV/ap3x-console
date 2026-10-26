import { asDict, num, record, sinceMs, text } from "../../core/format";
import type { Tone } from "../../core/types";

/* Local operations: the rackmain1 local-ops collector's GeoJSON (alerts, roads, power, NOAA radar
 * frame with bounds, map center) and the airspace collector's sanitized ADS-B snapshot. */

export const AIRSPACE_SOURCE = { id: "airspace", url: "/airspace-data/current.json", optional: true };

export interface Aircraft {
  id: string; lat: number; lon: number; callsign: string; altitudeFt: number | null; ground: boolean;
  trackDeg: number; speedKt: number | null; distanceNm: number | null; emergency: boolean; military: boolean;
  squawk: string | null; verticalRate: number | null; category: string | null; seenPos: number | null;
}

export interface LocalAlert { headline: string; severity: string; kind: string; area: string | null; expires: string | null }

export type Bounds = [[number, number], [number, number]];

export interface LocalModel {
  available: boolean;
  state: string;
  summary: string | null;
  roads: number;
  power: number | null;
  powerState: string | null;
  critical: number;
  headline: string | null;
  alerts: LocalAlert[];
  shapes: { type: "Feature"; geometry: unknown; properties: { severity: string } }[];
  radarUrl: string | null;
  radarAt: string | null;
  radarState: string;
  radarBounds: Bounds | null;
  center: { lat: number; lon: number } | null;
  aircraft: number | null;
  airState: string;
  aircraftList: Aircraft[];
  aircraftFresh: boolean;
}

const CRITICAL = ["EXTREME", "CRITICAL", "EMERGENCY", "SEVERE", "HIGH", "WARNING"];
export const severityTone = (severity: string): Tone => (/EXTREME|CRITICAL|EMERGENCY|SEVERE|HIGH|WARNING/.test(severity) ? "bad"
  : /MODERATE|WATCH/.test(severity) ? "warn" : "info");

export function validBounds(value: unknown): Bounds | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const pair = (p: unknown): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every((n) => Number.isFinite(n));
  if (!pair(value[0]) || !pair(value[1])) return null;
  const [[south, west], [north, east]] = value as Bounds;
  return Math.abs(south) <= 90 && Math.abs(north) <= 90 && south < north && west < east ? [[south, west], [north, east]] : null;
}

export function aircraftFrom(airspace: unknown): Aircraft[] {
  const list = asDict(airspace).aircraft;
  if (!Array.isArray(list)) return [];
  return list.filter(record).map((a) => ({
    id: text(a.id) ?? "",
    lat: num(a.lat) ?? NaN,
    lon: num(a.lon) ?? NaN,
    callsign: (text(a.callsign) ?? "").replace(/[^A-Z0-9 ._-]/gi, "").slice(0, 12),
    altitudeFt: num(a.altitude_ft),
    ground: String(a.altitude_state || "").toUpperCase() === "GROUND" || num(a.altitude_ft) === 0,
    trackDeg: num(a.track_deg) ?? 0,
    speedKt: num(a.ground_speed_kt),
    distanceNm: num(a.distance_nm),
    emergency: a.emergency === true,
    military: a.military === true,
    squawk: /^[0-7]{4}$/.test(String(a.squawk ?? "")) ? String(a.squawk) : null,
    verticalRate: num(a.vertical_rate_fpm),
    category: /^[A-C][0-7]$/.test(String(a.category ?? "")) ? String(a.category) : null,
    seenPos: num(a.seen_pos_seconds),
  })).filter((a) => /^~?[0-9a-f]{6}$/i.test(a.id) && Number.isFinite(a.lat) && Number.isFinite(a.lon) &&
    Math.abs(a.lat) <= 90 && Math.abs(a.lon) <= 180)
    .sort((x, y) => Number(y.emergency) - Number(x.emergency) || (x.distanceNm ?? 1e9) - (y.distanceNm ?? 1e9))
    .slice(0, 80);
}

export const altitudeBand = (a: Aircraft): string => (a.emergency ? "emergency" : a.ground ? "ground" : a.altitudeFt === null ? "unknown"
  : a.altitudeFt < 10_000 ? "low" : a.altitudeFt < 25_000 ? "mid" : a.altitudeFt < 40_000 ? "high" : "upper");
export const altitudeText = (a: Aircraft): string => (a.ground ? "GND" : a.altitudeFt === null ? "ALT ?"
  : a.altitudeFt >= 10_000 ? `${Math.round(a.altitudeFt / 1000)}K` : `${Math.round(a.altitudeFt / 100) * 100}`);

export function parseLocal(map: unknown, airspace: unknown, now: number): LocalModel {
  const root = asDict(map);
  const available = record(map) && Array.isArray(root.features);
  const features = available ? (root.features as unknown[]).filter(record) : [];
  const props = (f: Record<string, unknown>) => asDict(f.properties);
  const active = features.filter((f) => {
    const expires = text(props(f).expires, props(f).ends, props(f).expires_at);
    return !expires || Date.parse(expires) > now;
  });
  const severity = (f: Record<string, unknown>) => (text(props(f).severity, props(f).priority, props(f).level) ?? "").toUpperCase();
  const critical = active.filter((f) => CRITICAL.includes(severity(f)));
  const roads = active.filter((f) => /ROAD|TRAFFIC|CLOSURE/.test((text(props(f).kind, props(f).category, props(f).type) ?? "").toUpperCase()));
  const nyseg = asDict(asDict(root.sources).nyseg);
  const radar = asDict(root.radar);
  const air = asDict(airspace);
  const top = props(critical[0] ?? active[0] ?? {});
  const c = asDict(root.center);
  const lat = num(c.lat), lon = num(c.lon);
  return {
    available,
    state: (text(asDict(root.health).state, root.state) ?? (available ? "UNKNOWN" : "NO FEED")).toUpperCase(),
    summary: text(asDict(root.health).summary, root.summary),
    roads: roads.length,
    power: num(nyseg.without_power, nyseg.customers_without_power, nyseg.total_without_power),
    powerState: text(nyseg.state),
    critical: critical.length,
    headline: text(top.headline, top.title, top.event, top.summary),
    alerts: active.slice(0, 16).map((f) => {
      const p = props(f);
      return {
        headline: text(p.headline, p.title, p.event, p.summary) ?? "Local event",
        severity: (text(p.severity, p.priority, p.level) ?? "INFO").toUpperCase(),
        kind: (text(p.kind, p.category, p.type) ?? "").toUpperCase(),
        area: text(p.area, p.area_desc, p.location, p.county),
        expires: text(p.expires, p.ends, p.expires_at),
      };
    }),
    shapes: active.filter((f) => record(f.geometry)).slice(0, 60).map((f) => ({
      type: "Feature" as const, geometry: f.geometry, properties: { severity: severity(f) },
    })),
    radarUrl: text(radar.url),
    radarAt: text(radar.frame_at),
    radarState: (text(radar.state) ?? "OFFLINE").toUpperCase(),
    radarBounds: validBounds(radar.bounds) ?? validBounds(root.bounds),
    center: lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null,
    aircraft: num(air.count, air.aircraft_count, Array.isArray(air.aircraft) ? air.aircraft.length : null),
    airState: (text(air.state, air.status) ?? (record(airspace) ? "LIVE" : "UNKNOWN")).toUpperCase(),
    aircraftList: aircraftFrom(airspace),
    aircraftFresh: (sinceMs(air.generated_at, now) ?? Infinity) <= 10 * 60_000,
  };
}

/** Demo payloads somewhere neutral (central Kansas), never the real map center. */
export function demoLocal(now: number): Record<string, unknown> {
  const at = new Date(now).toISOString();
  const center = { lat: 38.5, lon: -98.0 };
  const bounds = [[37.4, -99.6], [39.6, -96.4]];
  const plane = (id: string, dLat: number, dLon: number, extra: Record<string, unknown>) => ({
    id, lat: center.lat + dLat, lon: center.lon + dLon, track_deg: 0, ground_speed_kt: 420, ...extra,
  });
  return {
    "local-ops": {
      type: "FeatureCollection", center, bounds,
      health: { state: "HEALTHY", summary: "Demo data: one weather advisory, roads clear." },
      radar: { state: "DEMO", url: null, frame_at: at, bounds },
      sources: { nyseg: { state: "LIVE", without_power: 0 } },
      features: [
        { type: "Feature", geometry: { type: "Polygon", coordinates: [[[-98.6, 38.1], [-97.6, 38.1], [-97.6, 38.8], [-98.6, 38.8], [-98.6, 38.1]]] },
          properties: { headline: "Wind Advisory until 9 PM", severity: "MODERATE", kind: "WEATHER", area: "Demo County", expires: new Date(now + 4 * 3_600_000).toISOString() } },
      ],
    },
    airspace: {
      generated_at: at, state: "LIVE", count: 5,
      aircraft: [
        plane("a1b2c3", 0.12, -0.3, { callsign: "UAL1505", altitude_ft: 34000, track_deg: 282, ground_speed_kt: 462, distance_nm: 8.2, category: "A3", squawk: "3341", vertical_rate_fpm: 0, seen_pos_seconds: 1.2 }),
        plane("a1b2c4", -0.2, 0.15, { callsign: "N123AB", altitude_ft: 4500, track_deg: 210, ground_speed_kt: 118, distance_nm: 14.1, category: "A1", squawk: "1200", vertical_rate_fpm: -320, seen_pos_seconds: 0.8 }),
        plane("ae0001", 0.45, 0.5, { callsign: "RCH402", altitude_ft: 22000, track_deg: 300, ground_speed_kt: 395, distance_nm: 31, military: true, category: "A5", squawk: "4127", vertical_rate_fpm: 1500, seen_pos_seconds: 2.4 }),
        plane("a2c3d0", -0.5, -0.6, { callsign: "DAL237", altitude_ft: 38000, track_deg: 95, distance_nm: 36, category: "A3" }),
        plane("a2c3d1", 0.7, -0.9, { callsign: "SWA88", altitude_ft: 12500, track_deg: 160, distance_nm: 44, category: "A3" }),
      ],
    },
  };
}

