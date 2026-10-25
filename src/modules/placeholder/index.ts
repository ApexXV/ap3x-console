import { el } from "../../core/dom";
import type { ModuleManifest } from "../../core/types";

/* Holds a layout slot for a panel not yet ported from Command 57 (see docs/PHASE1.md). */

export const placeholderModule: ModuleManifest<{ name: string }, { name: string }> = {
  id: "placeholder",
  title: "COMING SOON",
  description: "Reserves a layout slot for a module that is still being ported.",
  version: "1.0.0",
  defaults: { name: "Module" },
  sources: [],
  model: (ctx) => ({ name: String(ctx.settings.name || "Module") }),
  render(body, m) {
    body.replaceChildren(el("p", "empty", `${m.name} · being ported to the console`));
  },
  chip: () => ({ label: "PHASE 1", tone: "muted" }),
};
