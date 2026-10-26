import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/detail.css";
import "./styles/chrome.css";
import { Console } from "./core/console";
import { validateLayout } from "./core/layout";
import { getModule } from "./core/registry";
import type { Layout } from "./core/types";
import { registerBuiltins } from "./modules";

/* Layouts ship with the build; ?layout=<id> picks one, ?demo forces demo data, ?privacy=on blurs names. */
const layouts = import.meta.glob<Layout>("../layouts/*.json", { eager: true, import: "default" });

function boot(): void {
  registerBuiltins();
  const params = new URLSearchParams(location.search);
  const wanted = params.get("layout") ?? "command-57";
  const layout = Object.values(layouts).find((l) => l.id === wanted);
  const root = document.getElementById("app")!;
  const problems = layout ? validateLayout(layout, (id) => Boolean(getModule(id))) : [`no layout named "${wanted}"`];
  if (!layout || problems.length) {
    root.textContent = `Layout problem: ${problems.join("; ")}. Available: ${Object.values(layouts).map((l) => l.id).join(", ")}`;
    return;
  }
  const live = params.get("runtime") === "live" || (!params.has("demo") && !["localhost", "127.0.0.1"].includes(location.hostname));
  const console_ = new Console({ layout, root, mode: live ? "live" : "demo" }).mount();
  if (params.get("privacy") === "on") root.dataset.privacy = "on";
  // Tell a hosting shell (the Lively package) the console is up, so it can drop its fallback.
  void console_.start().then(() => { if (window.parent !== window) window.parent.postMessage({ type: "ap3x-console-ready", layout: layout.id }, "*"); });
}

boot();
