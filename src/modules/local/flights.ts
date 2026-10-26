import { asDict, text } from "../../core/format";
import type { RunMode } from "../../core/types";
import type { Aircraft } from "./parse";

/* Flight details for a tapped aircraft, looked up in the browser from public sources and cached
 * per aircraft for the page's life: registry and route from adsbdb.com, route fallback from adsb.lol. */

export interface Airport { code: string | null; name: string | null; city: string | null }
export interface Lookup {
  state: "loading" | "ok" | "none";
  aircraft: { type: string | null; icaoType: string | null; registration: string | null; owner: string | null; country: string | null; photo: string | null } | null;
  route: { origin: Airport; destination: Airport; airline: string | null } | null;
}

export const CATEGORY_NAMES: Record<string, string> = {
  A1: "Light aircraft", A2: "Small aircraft", A3: "Large aircraft", A4: "High-vortex large (757)", A5: "Heavy aircraft",
  A6: "High performance", A7: "Rotorcraft", B1: "Glider / sailplane", B2: "Balloon / airship", B3: "Parachutist",
  B4: "Ultralight", B6: "Drone (UAV)", B7: "Space vehicle", C1: "Emergency vehicle", C2: "Service vehicle", C3: "Obstacle",
};
export const SQUAWK_MEANINGS: Record<string, string> = { "7500": "HIJACK", "7600": "NO RADIO", "7700": "EMERG", "1200": "VFR" };

const lookups = new Map<string, Lookup>();
export const cachedLookup = (id: string): Lookup | undefined => lookups.get(id);

async function json(url: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetcher(url, { ...init, signal: controller.signal });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const httpsUrl = (value: unknown) => (typeof value === "string" && /^https:\/\/[^\s"'<>]+$/.test(value) ? value : null);
function airport(value: unknown): Airport | null {
  const d = asDict(value);
  const code = text(d.iata_code, d.iata, d.icao_code, d.icao);
  const name = text(d.name);
  return code || name ? { code: code?.toUpperCase() ?? null, name, city: text(d.municipality, d.location) } : null;
}

function demoLookup(a: Aircraft): Lookup {
  const samples: Record<string, Omit<NonNullable<Lookup["aircraft"]>, "photo"> & { route: Lookup["route"] }> = {
    a1b2c3: { type: "Boeing 737-824", icaoType: "B738", registration: "N78511", owner: "United Airlines", country: "United States",
      route: { origin: { code: "EWR", name: "Newark Liberty International Airport", city: "Newark" }, destination: { code: "DEN", name: "Denver International Airport", city: "Denver" }, airline: "United Airlines" } },
    a1b2c4: { type: "Cessna 172S Skyhawk", icaoType: "C172", registration: "N123AB", owner: "Private owner", country: "United States", route: null },
    ae0001: { type: "Boeing C-17A Globemaster III", icaoType: "C17", registration: "05-5140", owner: "United States Air Force", country: "United States", route: null },
  };
  const sample = samples[a.id.toLowerCase()];
  if (!sample) return { state: "none", aircraft: null, route: null };
  const { route, ...aircraft } = sample;
  return { state: "ok", aircraft: { ...aircraft, photo: null }, route };
}

/** Starts (or reuses) a lookup; `done` runs once when a new lookup finishes. */
export function lookupFlight(a: Aircraft, mode: RunMode, done: () => void, fetcher: typeof fetch = fetch): Lookup {
  const existing = lookups.get(a.id);
  if (existing) return existing;
  if (mode === "demo") {
    const entry = demoLookup(a);
    lookups.set(a.id, entry);
    return entry;
  }
  const entry: Lookup = { state: "loading", aircraft: null, route: null };
  lookups.set(a.id, entry);
  void (async () => {
    if (!a.id.startsWith("~")) {
      const db = asDict(asDict(await json(`https://api.adsbdb.com/v0/aircraft/${encodeURIComponent(a.id)}${a.callsign ? `?callsign=${encodeURIComponent(a.callsign)}` : ""}`, {}, fetcher)).response);
      const ac = asDict(db.aircraft);
      if (Object.keys(ac).length) {
        entry.aircraft = {
          type: text([text(ac.manufacturer), text(ac.type)].filter(Boolean).join(" ")),
          icaoType: text(ac.icao_type), registration: text(ac.registration),
          owner: text(ac.registered_owner), country: text(ac.registered_owner_country_name),
          photo: httpsUrl(ac.url_photo_thumbnail) ?? httpsUrl(ac.url_photo),
        };
      }
      const fr = asDict(db.flightroute);
      const from = airport(fr.origin), to = airport(fr.destination);
      if (from && to) entry.route = { origin: from, destination: to, airline: text(asDict(fr.airline).name) };
    }
    if (!entry.route && a.callsign) {
      const routes = await json("https://api.adsb.lol/api/0/routeset", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planes: [{ callsign: a.callsign, lat: a.lat, lng: a.lon }] }),
      }, fetcher);
      const r = asDict(Array.isArray(routes) ? routes[0] : null);
      const airports = Array.isArray(r._airports) ? r._airports : [];
      const from = airport(airports[0]), to = airport(airports[airports.length - 1]);
      if (r.plausible !== false && airports.length >= 2 && from && to) entry.route = { origin: from, destination: to, airline: text(r.airline_name) };
    }
    entry.state = entry.aircraft || entry.route ? "ok" : "none";
    done();
  })();
  return entry;
}
