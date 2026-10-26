import { el, sparkline, tile, tileRow } from "../../core/dom";
import { note, sec } from "../../core/detail";
import { clockOf } from "../../core/format";
import type { Chip, ModuleContext, ModuleManifest } from "../../core/types";
import { demoWeather, ensureForecast, LOCAL_OPS_SOURCE, parseWeather, type Day, type Weather, WEATHER_SOURCE } from "./parse";
import "./weather.css";

/* Local weather: current conditions and the next days. */

const deg = (v: number | null) => (v === null ? "—" : `${Math.round(v)}°`);

export function dayCard(d: Day): HTMLElement {
  const card = el("div", "wx-day");
  const temps = el("b", "", d.high === null ? deg(d.low) : deg(d.high));
  if (d.high !== null && d.low !== null) temps.append(el("small", "", deg(d.low)));
  card.append(el("span", "", d.name.slice(0, 3)), temps, el("em", "", d.pop ? `${Math.round(d.pop)}%` : "DRY"));
  card.title = d.short ?? "";
  return card;
}

const model = (ctx: ModuleContext) => parseWeather(ctx.sources.weather?.data, ctx.sources["local-ops"]?.data);

export function weatherChip(m: Weather): Chip {
  return m.available ? { label: m.condition ? m.condition.toUpperCase().slice(0, 18) : "LIVE", tone: "info" } : { label: "NO FEED", tone: "muted" };
}

export const weatherModule: ModuleManifest<Weather> = {
  id: "weather",
  title: "WEATHER",
  description: "Current local conditions from rackmain1's weather feed and a 7-day forecast from the National Weather Service.",
  version: "1.0.0",
  sources: [WEATHER_SOURCE, LOCAL_OPS_SOURCE],

  model,

  render(body, m, ctx) {
    if (ctx.mode === "live") ensureForecast(m.center, ctx.now, () => weatherModule.render(body, model(ctx), ctx));
    const now = el("div", "wx-now");
    now.append(el("b", "wx-temp", deg(m.temp)), (() => {
      const copy = el("div", "wx-copy");
      copy.append(el("span", "", m.condition ?? (m.available ? "—" : "Weather feed unavailable")), el("small", "", m.feels === null ? "" : `FEELS ${deg(m.feels)}`));
      return copy;
    })());
    const figures = tileRow([
      tile("WIND", m.wind === null ? null : `${Math.round(m.wind)} mph`, "info"),
      tile("RAIN", m.rain === null ? null : `${Math.round(m.rain)}%`, m.rain !== null && m.rain >= 50 ? "warn" : "info"),
      tile("HUMIDITY", m.humidity === null ? null : `${Math.round(m.humidity)}%`, "info"),
    ], 3);
    const days = el("div", "wx-days");
    days.append(...(m.forecast?.days ?? []).slice(1, 6).map(dayCard));
    body.replaceChildren(now, figures, m.forecast?.days.length ? days : el("p", "empty", "Forecast loading"));
  },

  chip: weatherChip,

  detail(m) {
    const days = el("div", "wx-days is-large");
    days.append(...(m.forecast?.days ?? []).map((d) => {
      const card = dayCard(d);
      card.append(el("p", "", d.short ?? ""));
      return card;
    }));
    const hours = m.forecast?.hours ?? [];
    const hourly = el("div", "wx-hourly");
    if (hours.length > 1) {
      hourly.append(sparkline([{ values: hours.map((h) => h.temp ?? 0), tone: "warn", fill: true }, { values: hours.map((h) => h.pop), tone: "info" }], "Next hours: temperature and rain chance"));
      const marks = el("div", "wx-marks");
      marks.append(...hours.filter((_, i) => i % 3 === 0).map((h) => el("span", "", `${clockOf(h.time)} ${deg(h.temp)}`)));
      hourly.append(marks);
    }
    return {
      title: "LOCAL WEATHER",
      chip: weatherChip(m),
      foot: m.forecast ? `Forecast: ${m.forecast.source.toLowerCase()}` : "Forecast needs the local-ops map center or a forecast in the weather feed",
      columns: "minmax(0, 1fr)", rows: "minmax(0, 1fr) auto",
      sections: [
        sec("7 DAYS", m.forecast?.days.length ? days : note("Forecast unavailable right now.")),
        sec("NEXT HOURS · TEMPERATURE AND RAIN CHANCE", hours.length > 1 ? hourly : note("Hourly forecast arrives with the National Weather Service forecast.")),
      ],
    };
  },

  demo: demoWeather,
};
