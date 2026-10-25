import { el, setTone } from "../../core/dom";
import { dlist, note, sec } from "../../core/detail";
import type { ModuleManifest, Tone } from "../../core/types";
import { demoWeather, LOCAL_OPS_SOURCE, parseWeather, WEATHER_SOURCE } from "../weather/parse";
import "./climate.css";

/* Lab climate and lighting. Outdoor conditions are live; indoor temperature, HVAC, and lights are
 * reserved slots until hardware is chosen. Each slot says what it needs rather than faking a control. */

interface Slot { key: string; label: string; value: string; note: string; tone: Tone; connected: boolean }
interface ClimateModel { outdoor: number | null; condition: string | null; slots: Slot[] }

const deg = (v: number | null) => (v === null ? "—" : `${Math.round(v)}°F`);

export const climateModule: ModuleManifest<ClimateModel> = {
  id: "lab-climate",
  title: "LAB CLIMATE",
  description: "Lab climate and lighting: live outdoor conditions, with indoor temperature, HVAC, and light controls added as hardware arrives.",
  version: "1.0.0",
  sources: [WEATHER_SOURCE, LOCAL_OPS_SOURCE],

  model(ctx) {
    const w = parseWeather(ctx.sources.weather?.data, ctx.sources["local-ops"]?.data);
    return {
      outdoor: w.temp,
      condition: w.condition,
      slots: [
        { key: "outdoor", label: "OUTSIDE", value: deg(w.temp), note: w.condition ?? (w.available ? "Live" : "Weather feed unavailable"), tone: w.available ? "info" : "muted", connected: w.available },
        { key: "indoor", label: "LAB TEMP", value: "—", note: "No sensor yet", tone: "muted", connected: false },
        { key: "hvac", label: "HEAT / COOL", value: "NOT LINKED", note: "No smart control yet", tone: "muted", connected: false },
        { key: "lights", label: "LIGHTS", value: "NOT LINKED", note: "No smart lights yet", tone: "muted", connected: false },
      ],
    };
  },

  render(body, m) {
    const grid = el("div", "climate-grid");
    grid.append(...m.slots.map((s) => {
      const card = el("div", s.connected ? "climate-slot" : "climate-slot is-pending");
      setTone(card, s.tone);
      card.append(el("span", "", s.label), el("b", "", s.value), el("small", "", s.note));
      return card;
    }));
    body.replaceChildren(grid);
  },

  chip: (m) => ({ label: `${m.slots.filter((s) => s.connected).length} OF ${m.slots.length} LIVE`, tone: "muted" }),

  detail(m) {
    return {
      title: "LAB CLIMATE & LIGHTS",
      foot: "Controls appear here once hardware is connected; nothing on this screen changes the lab today",
      columns: "minmax(0, 1fr)", rows: "auto minmax(0, 1fr)",
      sections: [
        sec("OUTSIDE", note(m.outdoor === null ? "Outdoor conditions unavailable." : `${deg(m.outdoor)} · ${m.condition ?? "conditions unknown"}`)),
        sec("WHAT EACH SLOT NEEDS", dlist([
          { title: "Lab temperature & humidity", detail: "A Wi-Fi or Zigbee temperature/humidity sensor in the lab (resin and filament both care about humidity).", tag: "SENSOR", tone: "muted" },
          { title: "Heating & cooling", detail: "A smart thermostat, a mini-split with a Wi-Fi controller, or smart plugs on heaters/fans, ideally all through one hub such as Home Assistant.", tag: "HVAC", tone: "muted" },
          { title: "Lights", detail: "Smart switches, plugs, or bulbs. Through Home Assistant, one integration covers lights, HVAC, and sensors.", tag: "LIGHTS", tone: "muted" },
        ])),
      ],
    };
  },

  demo: demoWeather,
};
