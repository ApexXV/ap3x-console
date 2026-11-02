import { el, setTone } from "../../core/dom";
import type { ModuleManifest, Tone } from "../../core/types";
import "./projects.css";

/** This board is deliberately local to the kiosk. It does not write to a project service. */
const STATUSES = ["NEXT", "DOING", "WAITING", "DONE"] as const;
type Status = typeof STATUSES[number];
interface Project { id: string; title: string; next: string; status: Status }
interface Settings extends Record<string, unknown> { projects: Project[] }
interface Model { projects: Project[] }

const STORAGE_PREFIX = "ap3x-mission-project-status:";
const sessionStatuses = new Map<string, Status>();
const tones: Record<Status, Tone> = { NEXT: "info", DOING: "good", WAITING: "warn", DONE: "muted" };

function status(value: unknown): Status | null {
  return typeof value === "string" && STATUSES.includes(value as Status) ? value as Status : null;
}

function savedStatus(project: Project): Status {
  try {
    const saved = status(window.localStorage.getItem(STORAGE_PREFIX + project.id));
    if (saved) return saved;
  } catch { /* Private browsing may disable storage. The in-memory value still works. */ }
  return sessionStatuses.get(project.id) ?? project.status;
}

function saveStatus(id: string, value: Status): void {
  sessionStatuses.set(id, value);
  try { window.localStorage.setItem(STORAGE_PREFIX + id, value); } catch { /* Session-only fallback. */ }
}

function parseProjects(raw: unknown): Project[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const projects: Project[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id : "";
    const title = typeof row.title === "string" ? row.title.trim().slice(0, 70) : "";
    const next = typeof row.next === "string" ? row.next.trim().slice(0, 140) : "";
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(id) || seen.has(id) || !title || !next) continue;
    seen.add(id);
    projects.push({ id, title, next, status: status(row.status) ?? "NEXT" });
    if (projects.length === 4) break;
  }
  return projects;
}

export const missionProjectsModule: ModuleManifest<Model, Settings> = {
  id: "mission-projects",
  title: "AP3X PROJECT BOARD",
  description: "A short AP3X project and research board whose status changes are saved only on this screen.",
  version: "1.0.0",
  defaults: { projects: [] },
  sources: [],

  model: (ctx) => ({ projects: parseProjects(ctx.settings.projects) }),

  render(body, model) {
    const intro = el("div", "mission-projects-intro");
    intro.append(el("strong", "", "AP3X PROJECTS"), el("small", "", "STATUS SAVED ONLY ON THIS SCREEN"));
    const grid = el("div", "mission-projects-grid");
    for (const project of model.projects) {
      const card = el("article", "mission-project");
      const title = el("h4", "", project.title);
      const step = el("div", "mission-project-step");
      step.append(el("span", "", "NEXT STEP"), el("p", "", project.next));
      const control = el("button", "mission-project-status");
      control.type = "button";
      const paint = (value: Status) => {
        setTone(card, tones[value]);
        setTone(control, tones[value]);
        control.textContent = value;
        control.setAttribute("aria-label", `${project.title}: ${value}. Tap to change local status.`);
      };
      paint(savedStatus(project));
      control.addEventListener("click", (event) => {
        event.stopPropagation();
        const current = savedStatus(project);
        const next = STATUSES[(STATUSES.indexOf(current) + 1) % STATUSES.length]!;
        saveStatus(project.id, next);
        paint(next);
      });
      card.append(title, step, control);
      grid.append(card);
    }
    if (!model.projects.length) grid.append(el("p", "empty", "Add AP3X projects to the mission-touch layout."));
    body.replaceChildren(intro, grid);
  },

  chip: (model) => ({ label: `${model.projects.length} LOCAL PROJECT${model.projects.length === 1 ? "" : "S"}`, tone: model.projects.length ? "info" : "muted" }),
};
