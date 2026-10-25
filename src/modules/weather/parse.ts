import { asDict, num, pick, record, text } from "../../core/format";

/* Current conditions come from rackmain1's /api/weather (the same source as Command 57). The
 * forecast comes from that feed when it carries one, otherwise from the US National Weather
 * Service for the local-ops map center, fetched by the browser and cached for 30 minutes. */

export const WEATHER_SOURCE = { id: "weather", url: "/api/weather", optional: true };
export const LOCAL_OPS_SOURCE = { id: "local-ops", url: "/local-ops-data/current.geojson", optional: true };

export interface Day { name: string; high: number | null; low: number | null; short: string | null; pop: number | null }
export interface Hour { time: string | null; temp: number | null; pop: number }
export interface Forecast { source: string; days: Day[]; hours: Hour[] }

export interface Weather {
  available: boolean;
  temp: number | null; condition: string | null; feels: number | null; wind: number | null; rain: number | null;
  humidity: number | null;
  center: { lat: number; lon: number } | null;
  forecast: Forecast | null;
}

const FORECAST_TTL_MS = 30 * 60_000;
const RETRY_MS = 5 * 60_000;
let cache: { key: string | null; at: number; data: Forecast | null; pending: boolean } = { key: null, at: 0, data: null, pending: false };

export function parseWeather(payload: unknown, localOps: unknown): Weather {
  const w = record(payload) ? payload : null;
  const c = asDict(asDict(localOps).center);
  const lat = num(c.lat), lon = num(c.lon);
  const center = lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
  return {
    available: w !== null,
    temp: num(pick(w, ["temperature_f", "temperature", "current.temperature_f", "current.temp_f", "current.temperature"])),
    condition: text(pick(w, ["condition", "summary", "current.condition", "current.summary", "description", "current.description", "weather.0.description"])),
    feels: num(pick(w, ["feels_like_f", "feels_like", "current.feels_like_f", "current.feels_like", "current.apparent_temperature"])),
    wind: num(pick(w, ["wind_mph", "current.wind_mph", "current.wind_speed_mph"])),
    rain: num(pick(w, ["precipitation_probability", "rain_probability", "rain_chance", "current.precipitation_probability", "current.rain_chance"])),
    humidity: num(pick(w, ["humidity", "relative_humidity", "current.humidity", "current.relative_humidity"])),
    center,
    forecast: feedForecast(w) ?? (center && cache.key === keyOf(center) ? cache.data : null),
  };
}

function feedForecast(weather: unknown): Forecast | null {
  const list = pick(weather, ["forecast.daily", "daily", "forecast.periods", "periods", "forecast"]);
  if (!Array.isArray(list) || list.length < 2) return null;
  const days = list.filter(record).slice(0, 7).map((d) => ({
    name: (text(d.name, d.day, d.label) ?? text(d.date)?.slice(5) ?? "—").toUpperCase(),
    high: num(d.high_f, d.high, d.temp_max, d.max, d.temperature_max, d.temperature),
    low: num(d.low_f, d.low, d.temp_min, d.min, d.temperature_min),
    short: text(d.condition, d.summary, d.shortForecast, d.description),
    pop: num(d.precipitation_probability, d.pop, d.rain_chance),
  }));
  return { source: "WEATHER FEED", days, hours: [] };
}

const keyOf = (c: { lat: number; lon: number }) => `${c.lat.toFixed(2)},${c.lon.toFixed(2)}`;

/** Starts a background NWS fetch when the cached forecast is missing or old; calls `done` when it lands. */
export function ensureForecast(center: { lat: number; lon: number } | null, now: number, done: () => void, fetcher: typeof fetch = fetch): void {
  if (!center || cache.pending) return;
  const key = keyOf(center);
  if (cache.key === key && now - cache.at < (cache.data ? FORECAST_TTL_MS : RETRY_MS)) return;
  cache = { ...cache, pending: true };
  void nwsForecast(center, fetcher).then((data) => {
    cache = { key, at: Date.now(), data: data ?? (cache.key === key ? cache.data : null), pending: false };
    if (data) done();
  });
}

async function nwsJson(url: string, fetcher: typeof fetch): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetcher(url, { headers: { Accept: "application/geo+json" }, signal: controller.signal });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function nwsForecast(center: { lat: number; lon: number }, fetcher: typeof fetch): Promise<Forecast | null> {
  const points = asDict(asDict(await nwsJson(`https://api.weather.gov/points/${center.lat.toFixed(4)},${center.lon.toFixed(4)}`, fetcher)).properties);
  const dailyUrl = text(points.forecast);
  if (!dailyUrl) return null;
  const hourlyUrl = text(points.forecastHourly);
  const [daily, hourly] = await Promise.all([nwsJson(dailyUrl, fetcher), hourlyUrl ? nwsJson(hourlyUrl, fetcher) : null]);
  const periods = asDict(asDict(daily).properties).periods;
  if (!Array.isArray(periods) || !periods.length) return null;
  const pop = (p: Record<string, unknown>) => num(asDict(p.probabilityOfPrecipitation).value);
  const days: Day[] = [];
  for (let i = 0; i < periods.length && days.length < 7; i += 1) {
    const p = asDict(periods[i]);
    const next = asDict(periods[i + 1]);
    if (p.isDaytime === false && i > 0) continue;
    days.push({
      name: String(text(p.name) ?? "").toUpperCase().replace("THIS AFTERNOON", "TODAY"),
      high: p.isDaytime ? num(p.temperature) : null,
      low: p.isDaytime ? (next.isDaytime === false ? num(next.temperature) : null) : num(p.temperature),
      short: text(p.shortForecast),
      pop: Math.max(pop(p) ?? 0, p.isDaytime && next.isDaytime === false ? pop(next) ?? 0 : 0),
    });
    if (p.isDaytime) i += 1;
  }
  const hourPeriods = asDict(asDict(hourly).properties).periods;
  const hours = (Array.isArray(hourPeriods) ? hourPeriods : []).filter(record).slice(0, 12).map((h) => ({
    time: text(h.startTime), temp: num(h.temperature), pop: pop(h) ?? 0,
  }));
  return { source: "NATIONAL WEATHER SERVICE", days, hours };
}

export function demoWeather(now: number): Record<string, unknown> {
  const names = ["TODAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
  const shorts = ["Partly Sunny", "Chance Rain Showers", "Mostly Cloudy", "Sunny", "Mostly Sunny", "Showers Likely", "Partly Cloudy"];
  return {
    weather: {
      temperature_f: 52, condition: "Partly Cloudy", feels_like_f: 49, wind_mph: 8, precipitation_probability: 10, humidity: 61,
      forecast: { daily: names.map((name, i) => ({ name, high: 58 - i + (i % 3) * 3, low: 41 - (i % 4), condition: shorts[i], pop: [10, 40, 20, 0, 5, 60, 15][i] })) },
      generated_at: new Date(now).toISOString(),
    },
  };
}
