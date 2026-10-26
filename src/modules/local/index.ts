import { button, el, setTone, tile, tileRow, toneVar } from "../../core/dom";
import { dlist, note, place, sec, stats } from "../../core/detail";
import { clockOf } from "../../core/format";
import type { Chip, ModuleContext, ModuleManifest, RunMode, Tone } from "../../core/types";
import { dayCard } from "../weather";
import { demoWeather, ensureForecast, LOCAL_OPS_SOURCE, parseWeather, type Weather, WEATHER_SOURCE } from "../weather/parse";
import { cachedLookup, CATEGORY_NAMES, lookupFlight, SQUAWK_MEANINGS } from "./flights";
import { updateRadarMap } from "./map";
import { AIRSPACE_SOURCE, type Aircraft, altitudeText, demoLocal, type LocalModel, parseLocal, severityTone } from "./parse";
import "./local.css";

/* Local weather & radar: current conditions, a radar map with alerts and live aircraft, and the
 * roads / power / airspace / alert counts. The detail view adds flight cards and the forecast. */

interface Model { local: LocalModel; weather: Weather; mode: RunMode }

const PLANES_PER_PAGE = 7;
const deg = (v: number | null) => (v === null ? "—" : `${Math.round(v)}°`);

function model(ctx: ModuleContext): Model {
  return {
    local: parseLocal(ctx.sources["local-ops"]?.data, ctx.sources.airspace?.data, ctx.now),
    weather: parseWeather(ctx.sources.weather?.data, ctx.sources["local-ops"]?.data),
    mode: ctx.mode,
  };
}

function chipFor(m: Model): Chip {
  const l = m.local;
  if (l.critical) return { label: `${l.critical} ALERT${l.critical === 1 ? "" : "S"}`, tone: "bad" };
  if (!l.available) return { label: "NO FEED", tone: "muted" };
  return l.state === "HEALTHY" ? { label: "LOCAL CLEAR", tone: "good" } : { label: l.state, tone: "warn" };
}

const emptyText = (m: Model) => (m.mode === "demo" ? "RADAR · DEMO MAP (NO RADAR FRAME)" : "RADAR · LOCAL OPS FEED UNAVAILABLE");

/* The panel keeps one skeleton per body so the Leaflet map isn't rebuilt every refresh. */
interface Panel { weather: HTMLElement; map: HTMLElement; empty: HTMLElement; label: HTMLElement; facts: HTMLElement }
const panels = new WeakMap<HTMLElement, Panel>();

function skeleton(body: HTMLElement): Panel {
  const existing = panels.get(body);
  if (existing && body.contains(existing.map)) return existing;
  const weather = el("div", "lo-weather");
  const frame = el("div", "lo-radar");
  const map = el("div", "lo-map");
  map.setAttribute("role", "img");
  map.setAttribute("aria-label", "Local radar map");
  const empty = el("div", "lo-empty");
  const label = el("span", "lo-label");
  frame.append(map, empty, label);
  const facts = el("div", "lo-facts");
  body.replaceChildren(weather, frame, facts);
  const panel = { weather, map, empty, label, facts };
  panels.set(body, panel);
  return panel;
}

function weatherLine(m: Model): HTMLElement[] {
  const w = m.weather;
  const temp = el("b", "lo-temp", deg(w.temp));
  const copy = el("div", "lo-copy");
  const next = w.forecast?.days[1];
  copy.append(
    el("span", "", (w.condition ?? (w.available ? "—" : "Weather unavailable")).toUpperCase()),
    el("small", "", [w.feels === null ? null : `FEELS ${deg(w.feels)}`, w.wind === null ? null : `WIND ${Math.round(w.wind)} MPH`,
      w.rain === null ? null : `RAIN ${Math.round(w.rain)}%`, next ? `${next.name.slice(0, 3)} ${deg(next.high ?? next.low)}` : null].filter(Boolean).join(" · ") || "—"),
  );
  return [temp, copy];
}

function factTiles(l: LocalModel): HTMLElement {
  return tileRow([
    tile("ROADS", l.available ? (l.roads ? `${l.roads} ACTIVE` : "CLEAR") : "UNKNOWN", l.available ? (l.roads ? "warn" : "good") : "muted"),
    tile("POWER", l.power === null ? (l.powerState ?? "UNKNOWN") : `${Math.round(l.power)} OUT`, l.power ? "warn" : l.power === 0 ? "good" : "muted"),
    tile("AIRSPACE", l.aircraft === null ? l.airState : `${Math.round(l.aircraft)} A/C`, l.aircraftFresh ? "info" : "muted"),
    tile("ALERTS", l.available ? `${l.critical} CRIT` : "UNKNOWN", l.available ? (l.critical ? "bad" : "good") : "muted"),
  ], 4);
}

/* ---------------- detail: radar with flight cards, aircraft list, events, forecast ---------------- */

let detailMap: HTMLElement | null = null;

function flightCard(m: Model, hooks: { state: Record<string, unknown>; rebuild(): void }): HTMLElement | null {
  const list = m.local.aircraftList;
  const a = list.find((p) => p.id === hooks.state.selected);
  if (!a) return null;
  const lookup = cachedLookup(a.id) ?? lookupFlight(a, m.mode, () => { if (hooks.state.selected === a.id) hooks.rebuild(); });
  const info = lookup.aircraft;
  const card = el("aside", "flight-card");
  card.addEventListener("click", (event) => event.stopPropagation());
  const head = el("header");
  const name = el("div");
  name.append(el("b", "", a.callsign || a.id.toUpperCase()), el("span", "", `ICAO ${a.id.toUpperCase()}${a.military ? " · MILITARY" : ""}${a.emergency ? " · EMERGENCY" : ""}`));
  const position = list.findIndex((p) => p.id === a.id);
  const step = (delta: number) => () => {
    const next = list[(position + delta + list.length) % list.length]!;
    hooks.state.selected = next.id;
    hooks.state.page = Math.floor(list.indexOf(next) / PLANES_PER_PAGE);
    hooks.rebuild();
  };
  head.append(name, el("small", "", `${position + 1} / ${list.length}`),
    button("‹", "Previous aircraft", step(-1), "btn fc-btn"), button("›", "Next aircraft", step(1), "btn fc-btn"),
    button("✕", "Close flight details", () => { hooks.state.selected = null; hooks.rebuild(); }, "btn fc-btn"));
  card.append(head);
  if (info?.photo) {
    const photo = el("img", "fc-photo");
    photo.alt = "";
    photo.referrerPolicy = "no-referrer";
    photo.addEventListener("error", () => photo.remove());
    photo.src = info.photo;
    card.append(photo);
  }
  const facts = el("dl", "fc-facts");
  const fact = (label: string, value: string | null, tone?: Tone) => {
    const row = el("div");
    const dd = el("dd", "", value || "—");
    if (tone) dd.style.color = toneVar(tone);
    row.append(el("dt", "", label), dd);
    facts.append(row);
  };
  const pending = lookup.state === "loading" ? "Looking up…" : null;
  const missing = lookup.state === "none" ? "No public record" : "—";
  const route = lookup.route;
  fact("TYPE", pending ?? ([info?.type, info?.icaoType ? `(${info.icaoType})` : null].filter(Boolean).join(" ") || (a.category ? CATEGORY_NAMES[a.category] ?? null : null) || missing));
  fact("REGISTRATION", pending ?? info?.registration ?? missing);
  fact("OWNER / OPERATOR", pending ?? ([info?.owner, info?.country].filter(Boolean).join(" · ") || missing));
  fact("ROUTE", pending ?? (route ? `${route.origin.code ?? route.origin.name} → ${route.destination.code ?? route.destination.name}` : "Not published"), route ? "info" : undefined);
  if (route) fact("FROM / TO", [route.origin, route.destination].map((p) => [p.name, p.city].filter(Boolean).join(", ")).join("  →  "));
  if (route?.airline) fact("AIRLINE", route.airline);
  card.append(facts);
  const live = el("div", "fc-live");
  const squawk = a.squawk ? `${a.squawk}${SQUAWK_MEANINGS[a.squawk] ? ` · ${SQUAWK_MEANINGS[a.squawk]}` : ""}` : "—";
  const cells: [string, string, Tone | null][] = [
    ["ALTITUDE", a.ground ? "ON GROUND" : a.altitudeFt === null ? "—" : `${a.altitudeFt.toLocaleString("en-US")} FT`, null],
    ["SPEED", a.speedKt === null ? "—" : `${Math.round(a.speedKt)} KT`, null],
    ["HEADING", `${Math.round(a.trackDeg)}°`, null],
    ["CLIMB", a.verticalRate === null ? "—" : `${a.verticalRate > 0 ? "+" : ""}${a.verticalRate.toLocaleString("en-US")} FPM`, null],
    ["SQUAWK", squawk, a.squawk && ["7500", "7600", "7700"].includes(a.squawk) ? "bad" : null],
    ["CLASS", (a.category ? CATEGORY_NAMES[a.category] : null) ?? a.category ?? "—", null],
    ["DISTANCE", a.distanceNm === null ? "—" : `${a.distanceNm.toFixed(1)} NM`, null],
    ["SEEN", a.seenPos === null ? "—" : `${Math.round(a.seenPos)}S AGO`, null],
  ];
  for (const [label, value, tone] of cells) {
    const cell = el("div");
    const b = el("b", "", value);
    if (tone) b.style.color = toneVar(tone);
    cell.append(el("span", "", label), b);
    live.append(cell);
  }
  card.append(live, el("footer", "", m.mode === "demo" ? "Demo aircraft · sample registry data"
    : "Live: adsb.fi via rackmain1 · registry: adsbdb.com · routes: adsbdb / adsb.lol · public data, may be incomplete"));
  return card;
}

function aircraftSection(m: Model, hooks: { state: Record<string, unknown>; rebuild(): void }): HTMLElement {
  const list = m.local.aircraftList;
  if (!list.length) return sec("AIRCRAFT", note("No aircraft in the current airspace snapshot."), note("Aircraft data: adsb.fi · sanitized by the rackmain1 airspace collector"));
  const pages = Math.max(1, Math.ceil(list.length / PLANES_PER_PAGE));
  const page = Math.min(Number(hooks.state.page ?? 0), pages - 1);
  const start = page * PLANES_PER_PAGE;
  const rows = el("ol", "fc-list");
  rows.append(...list.slice(start, start + PLANES_PER_PAGE).map((a: Aircraft) => {
    const li = el("li", a.id === hooks.state.selected ? "is-selected" : "");
    setTone(li, a.emergency ? "bad" : a.military ? "warn" : "info");
    const known = cachedLookup(a.id)?.aircraft;
    const who = el("div");
    who.append(el("b", "", a.callsign || a.id.toUpperCase()), el("small", "", known?.icaoType ?? known?.type ?? (a.category ? CATEGORY_NAMES[a.category] : null) ?? "Tap for details"));
    li.append(who, el("span", "", altitudeText(a)), el("span", "", a.speedKt === null ? "—" : `${Math.round(a.speedKt)} KT`), el("em", "", a.distanceNm === null ? "—" : `${a.distanceNm.toFixed(1)} NM`));
    li.addEventListener("click", (event) => { event.stopPropagation(); hooks.state.selected = a.id; hooks.rebuild(); });
    return li;
  }));
  const pager = el("div", "pager");
  const turn = (delta: number) => () => { hooks.state.page = (page + delta + pages) % pages; hooks.rebuild(); };
  pager.append(button("▲", "Previous page", turn(-1)), el("span", "", `${start + 1}–${Math.min(list.length, start + PLANES_PER_PAGE)} OF ${list.length}`), button("▼", "Next page", turn(1)));
  return sec("AIRCRAFT · TAP FOR FLIGHT DETAILS", rows, pages > 1 ? pager : null);
}

export const localModule: ModuleManifest<Model> = {
  id: "local",
  title: "LOCAL · WEATHER & RADAR",
  description: "Local weather, a radar map with alerts and live aircraft, and road / power / airspace / alert counts, with flight cards and the forecast in detail.",
  version: "1.0.0",
  sources: [LOCAL_OPS_SOURCE, AIRSPACE_SOURCE, WEATHER_SOURCE],

  model,

  render(body, m, ctx) {
    if (ctx.mode === "live") ensureForecast(m.weather.center ?? m.local.center, ctx.now, () => localModule.render(body, model(ctx), ctx));
    const p = skeleton(body);
    p.weather.replaceChildren(...weatherLine(m));
    p.facts.replaceChildren(factTiles(m.local));
    p.label.textContent = `RADAR · ${m.local.radarAt ? `${clockOf(m.local.radarAt)} ET` : m.local.radarState}`;
    const shown = updateRadarMap(p.map, m.local, { labels: 5 });
    p.empty.hidden = shown;
    p.empty.textContent = emptyText(m);
  },

  ticker: (m) => (m.weather.temp === null ? [] : [{ label: "WEATHER", value: `${Math.round(m.weather.temp)}°F ${m.weather.condition ?? ""}`.trim(), order: 50 }]),

  chip: chipFor,

  detail(m, _ctx, hooks) {
    const l = m.local;
    const w = m.weather;
    detailMap ??= el("div", "lo-map is-large");
    const frame = el("div", "lo-radar is-large");
    frame.append(detailMap);
    const card = flightCard(m, hooks);
    if (card) frame.append(card);
    if (!l.radarBounds) frame.append(el("div", "lo-empty", emptyText(m)));
    // Leaflet measures its container, so update once the overlay has laid out.
    requestAnimationFrame(() => {
      if (detailMap?.isConnected) {
        updateRadarMap(detailMap, l, { labels: 12, selected: (hooks.state.selected as string | null) ?? null, onSelect: (id) => {
          const index = l.aircraftList.findIndex((a) => a.id === id);
          hooks.state.selected = id;
          hooks.state.page = Math.max(0, Math.floor(index / PLANES_PER_PAGE));
          hooks.rebuild();
        } });
      }
    });
    const days = el("div", "wx-days lo-days");
    days.append(...(w.forecast?.days ?? []).map((d) => {
      const c = dayCard(d);
      c.append(el("p", "", d.short ?? ""));
      return c;
    }));
    return {
      title: "LOCAL WEATHER & ALERTS",
      chip: chipFor(m),
      foot: l.summary ?? "Local operations feed from rackmain1",
      columns: "minmax(0, 1.3fr) minmax(0, 1fr)", rows: "auto minmax(0, 1fr) minmax(0, 1fr) auto",
      sections: [
        place(stats([
          ["TEMPERATURE", w.temp === null ? null : `${Math.round(w.temp)}°F`, "info", w.condition],
          ["FEELS LIKE", w.feels === null ? null : `${Math.round(w.feels)}°F`],
          ["WIND", w.wind === null ? null : `${Math.round(w.wind)} MPH`],
          ["RAIN", w.rain === null ? null : `${Math.round(w.rain)}%`],
          ["ROADS", l.available ? (l.roads ? `${l.roads} ACTIVE` : "CLEAR") : null, l.roads ? "warn" : "good"],
          ["POWER OUT", l.power === null ? l.powerState : Math.round(l.power), l.power ? "warn" : "good"],
          ["AIRCRAFT", l.aircraft === null ? l.airState : Math.round(l.aircraft)],
        ]), "1 / -1"),
        place(sec(`RADAR & AIRSPACE${l.radarAt ? ` · ${clockOf(l.radarAt)} ET` : ""}`, frame), "1", "2 / span 2"),
        aircraftSection(m, hooks),
        sec("ACTIVE EVENTS", l.alerts.length ? dlist(l.alerts.map((a) => ({
          title: a.headline, tag: a.severity, tone: severityTone(a.severity),
          detail: [a.kind, a.area, a.expires ? `until ${clockOf(a.expires)}` : null].filter(Boolean).join(" · "),
        }))) : note("No active local events.")),
        place(sec(`FORECAST${w.forecast ? ` · ${w.forecast.source}` : ""}`, w.forecast?.days.length ? days : note("Forecast unavailable. It needs the local-ops map center or a forecast in the weather feed.")), "1 / -1"),
      ],
    };
  },

  demo(now) {
    return { ...demoLocal(now), ...demoWeather(now) };
  },

  changes(previous, next) {
    const seen = new Set(previous.local.alerts.map((a) => a.headline));
    return next.local.alerts.filter((a) => !seen.has(a.headline)).slice(0, 3).map((a) => ({
      tone: severityTone(a.severity), kicker: "LOCAL", text: a.headline,
    }));
  },

  priority(m) {
    if (!m.local.critical) return null;
    return {
      rank: 60, kicker: "LOCAL / ALERT", title: m.local.headline ?? "Local alert active",
      summary: `${m.local.critical} critical local event${m.local.critical === 1 ? "" : "s"} active`, posture: "WARNING", tone: "bad",
    };
  },
};
