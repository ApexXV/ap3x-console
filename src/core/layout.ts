import type { Layout } from "./types";

const ID = /^[a-z][a-z0-9-]{0,40}$/;
const GRID = /^[\w\s().,%/-]+$/;  // CSS grid values: "1 / -1", "repeat(2, minmax(0, 1fr))", "1.2fr .8fr"

/** Checks a layout file before it is used. Returns human-readable problems; empty means valid. */
export function validateLayout(raw: unknown, knownModules: (id: string) => boolean): string[] {
  const problems: string[] = [];
  if (!raw || typeof raw !== "object") return ["layout must be a JSON object"];
  const layout = raw as Partial<Layout>;
  if (typeof layout.id !== "string" || !ID.test(layout.id)) problems.push("id must be lowercase letters, digits, or dashes");
  if (typeof layout.title !== "string" || !layout.title.trim()) problems.push("title is required");
  const stage = layout.stage;
  if (!stage || !(stage.width >= 640 && stage.width <= 16_384) || !(stage.height >= 360 && stage.height <= 8_640)) {
    problems.push("stage.width and stage.height must be a real screen size in px");
  }
  if (stage && !(stage.fontSize >= 8 && stage.fontSize <= 96)) problems.push("stage.fontSize must be between 8 and 96 px");
  if (typeof layout.regionColumns !== "string" || !GRID.test(layout.regionColumns)) problems.push("regionColumns must be a CSS grid template");
  if (layout.refreshSeconds !== undefined && !(layout.refreshSeconds >= 5 && layout.refreshSeconds <= 3600)) {
    problems.push("refreshSeconds must be between 5 and 3600");
  }
  if (layout.navigation !== undefined && !["columns", "pages"].includes(layout.navigation)) problems.push('navigation must be "columns" or "pages"');
  if (layout.chrome !== undefined && !["full", "compact"].includes(layout.chrome)) problems.push('chrome must be "full" or "compact"');
  if (layout.clock !== undefined && !["12h", "24h"].includes(layout.clock)) problems.push('clock must be "12h" or "24h"');
  for (const key of ["dock", "ticker", "nightMode", "music"] as const) {
    if (layout[key] !== undefined && typeof layout[key] !== "boolean") problems.push(`${key} must be true or false`);
  }
  if (layout.focus !== undefined) {
    const regionIds = new Set((layout.regions ?? []).map((r) => r?.id));
    if (!layout.focus || typeof layout.focus !== "object" || Array.isArray(layout.focus)) problems.push("focus must map region ids to column templates");
    else for (const [id, columns] of Object.entries(layout.focus)) {
      if (!regionIds.has(id)) problems.push(`focus.${id} is not a region`);
      if (typeof columns !== "string" || !GRID.test(columns)) problems.push(`focus.${id} must be a CSS grid template`);
    }
  }
  if (layout.links !== undefined) {
    if (!Array.isArray(layout.links)) problems.push("links must be a list");
    else layout.links.forEach((link, i) => {
      if (!link || typeof link.label !== "string" || typeof link.title !== "string" || typeof link.href !== "string" || !/^\/(?!\/)[\w./?=&-]*$/.test(link.href)) {
        problems.push(`links[${i}] needs a label, a title, and a same-origin href starting with /`);
      }
      if (link?.key !== undefined && !/^[a-z]$/.test(link.key)) problems.push(`links[${i}].key must be one lowercase letter`);
    });
  }
  if (layout.homeAfterSeconds !== undefined && (layout.navigation !== "pages" || !(layout.homeAfterSeconds >= 15 && layout.homeAfterSeconds <= 3600))) {
    problems.push("homeAfterSeconds needs navigation \"pages\" and must be between 15 and 3600");
  }
  if (!Array.isArray(layout.regions) || !layout.regions.length) return [...problems, "regions must be a non-empty list"];
  const panelIds = new Set<string>();
  const regionIds = new Set<string>();
  layout.regions.forEach((region, r) => {
    const where = `regions[${r}]`;
    if (!region || typeof region !== "object") { problems.push(`${where} must be an object`); return; }
    if (!ID.test(region.id ?? "") || regionIds.has(region.id)) problems.push(`${where}.id must be unique and lowercase`);
    regionIds.add(region.id);
    for (const key of ["columns", "rows"] as const) {
      if (typeof region[key] !== "string" || !GRID.test(region[key])) problems.push(`${where}.${key} must be a CSS grid template`);
    }
    if (!Array.isArray(region.panels)) { problems.push(`${where}.panels must be a list`); return; }
    region.panels.forEach((panel, p) => {
      const at = `${where}.panels[${p}]`;
      if (!panel || typeof panel !== "object") { problems.push(`${at} must be an object`); return; }
      if (!ID.test(panel.id ?? "") || panelIds.has(panel.id)) problems.push(`${at}.id "${panel.id}" must be unique and lowercase`);
      panelIds.add(panel.id);
      if (typeof panel.module !== "string" || !knownModules(panel.module)) problems.push(`${at}.module "${panel.module}" is not a registered module`);
      for (const key of ["column", "row"] as const) {
        if (panel[key] !== undefined && (typeof panel[key] !== "string" || !GRID.test(panel[key] as string))) problems.push(`${at}.${key} must be a CSS grid placement`);
      }
      if (panel.settings !== undefined && (typeof panel.settings !== "object" || panel.settings === null || Array.isArray(panel.settings))) {
        problems.push(`${at}.settings must be an object`);
      }
    });
  });
  return problems;
}
