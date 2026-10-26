import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { altitudeBand, altitudeText, type LocalModel, severityTone } from "./parse";

/* The radar map: OpenStreetMap tiles (darkened by CSS), the NOAA reflectivity frame the local-ops
 * collector publishes with its bounds, active alert shapes, and aircraft markers. One Leaflet map
 * per container element, kept and updated in place across refreshes. */

interface Entry {
  map: L.Map;
  bounds: L.LatLngBoundsExpression | null;
  overlay: L.ImageOverlay | null;
  url: string | null;
  fitted: string | null;
  shapes: L.GeoJSON | null;
  shapeKey: string | null;
  planes: L.LayerGroup;
  planeKey: string | null;
}

const maps = new WeakMap<HTMLElement, Entry>();
const TONE_COLOR = { bad: "#ff6b72", warn: "#f2b54f", info: "#38bdca", good: "#5fe0a6", muted: "#93acb9" } as const;

export interface MapOptions { labels: number; selected?: string | null; onSelect?: (id: string) => void }

/** Draws or updates the map in `container`. Returns false when there is nothing to place it on (no bounds). */
export function updateRadarMap(container: HTMLElement, local: LocalModel, options: MapOptions): boolean {
  if (!local.radarBounds) return false;
  try {
    let entry = maps.get(container);
    if (!entry) {
      const map = L.map(container, {
        zoomControl: false, attributionControl: true, dragging: false, scrollWheelZoom: false,
        doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false,
        fadeAnimation: false, zoomAnimation: false, markerZoomAnimation: false, zoomSnap: 0.25,
      });
      map.attributionControl.setPrefix(false);
      map.createPane("radarPane").style.zIndex = "260";
      map.createPane("aircraftPane").style.zIndex = "650";
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        minZoom: 4, maxZoom: 12, crossOrigin: true, keepBuffer: 1, updateWhenIdle: true,
        attribution: "&copy; OpenStreetMap contributors · Radar NOAA · Aircraft adsb.fi",
      }).addTo(map);
      entry = { map, bounds: null, overlay: null, url: null, fitted: null, shapes: null, shapeKey: null, planes: L.layerGroup().addTo(map), planeKey: null };
      maps.set(container, entry);
      // Re-fit when the panel changes size (a tab shown, a column widened), not only on the next refresh.
      if (typeof ResizeObserver !== "undefined") {
        const fresh = entry;
        new ResizeObserver(() => {
          if (!container.clientWidth || !fresh.bounds) return;
          fresh.map.invalidateSize(false);
          fresh.map.fitBounds(fresh.bounds, { animate: false, padding: [0, 0] });
          fresh.fitted = JSON.stringify(fresh.bounds);
        }).observe(container);
      }
    }
    const e = entry;
    e.map.invalidateSize(false);
    e.bounds = local.radarBounds;
    const boundsKey = JSON.stringify(local.radarBounds);
    if (e.fitted !== boundsKey && container.clientWidth > 0) {
      e.map.fitBounds(local.radarBounds, { animate: false, padding: [0, 0] });
      e.fitted = boundsKey;
    }
    if (local.radarUrl) {
      const url = `${local.radarUrl}${local.radarUrl.includes("?") ? "&" : "?"}v=${encodeURIComponent(local.radarAt ?? "")}`;
      if (e.url !== url) {
        const previous = e.overlay;
        const layer = L.imageOverlay(url, local.radarBounds, { pane: "radarPane", opacity: 0.7, interactive: false });
        layer.on("load", () => { if (previous && previous !== layer) previous.remove(); e.overlay = layer; });
        layer.on("error", () => layer.remove());
        layer.addTo(e.map);
        e.url = url;
      }
    }
    const shapeKey = JSON.stringify(local.shapes);
    if (e.shapeKey !== shapeKey) {
      e.shapes?.remove();
      const color = (severity: string) => TONE_COLOR[severityTone(severity)];
      e.shapes = local.shapes.length ? L.geoJSON(local.shapes as unknown as GeoJSON.GeoJsonObject, {
        interactive: false,
        style: (f) => ({ color: color(String(f?.properties?.severity ?? "")), weight: 2, fillOpacity: 0.12 }),
        pointToLayer: (f, latlng) => L.circleMarker(latlng, { radius: 6, color: color(String(f.properties?.severity ?? "")), weight: 2, fillOpacity: 0.5 }),
      }).addTo(e.map) : null;
      e.shapeKey = shapeKey;
    }
    const planes = local.aircraftList;
    const planeKey = JSON.stringify([planes, local.aircraftFresh, options.labels, options.selected ?? null, Boolean(options.onSelect)]);
    if (e.planeKey !== planeKey) {
      e.planes.clearLayers();
      const labelled = new Set(planes.slice(0, options.labels).map((a) => a.id));
      for (const a of planes) {
        const classes = ["ac-plane", `is-${altitudeBand(a)}`, a.military ? "is-military" : "", local.aircraftFresh ? "" : "is-stale", a.id === options.selected ? "is-selected" : ""];
        const label = labelled.has(a.id) ? `<b>${(a.callsign || a.id.toUpperCase()).replace(/[<>&"]/g, "")} · ${altitudeText(a)}</b>` : "";
        const marker = L.marker([a.lat, a.lon], {
          pane: "aircraftPane", interactive: Boolean(options.onSelect), keyboard: false,
          icon: L.divIcon({ className: "ac-plane-icon", html: `<span class="${classes.filter(Boolean).join(" ")}"><i style="transform:rotate(${Math.round(a.trackDeg)}deg)"></i>${label}</span>`, iconSize: [32, 32], iconAnchor: [16, 16] }),
        }).addTo(e.planes);
        if (options.onSelect) marker.on("click", () => options.onSelect!(a.id));
      }
      e.planeKey = planeKey;
    }
    return true;
  } catch (error) {
    console.warn("[local] radar map", error);
    return false;
  }
}
