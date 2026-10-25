import { el, setTone } from "../../core/dom";
import { clockOf, TZ } from "../../core/format";
import type { ModuleManifest, Tone } from "../../core/types";
import { labModule, parseLab, PRINTERS_SOURCE } from "../lab";
import { demoLabNode } from "../labnode/demo";
import { LAB_NODE_SOURCE, parseLabNode, rateText } from "../labnode/parse";
import { nodesModule, NODE_STATUS_SOURCE, parseNodes } from "../nodes";
import { demoWeather, LOCAL_OPS_SOURCE, parseWeather, WEATHER_SOURCE } from "../weather/parse";
import "./home.css";

/* The base screen for a small touch display: a large clock and date, current weather, and one
 * tile each for printers, machines, and network. A tile asks the console to open its page. */

interface Card { key: string; label: string; value: string; detail: string; tone: Tone; page: string | null }
interface HomeModel { place: string; temp: number | null; condition: string | null; cards: Card[] }
interface HomeSettings extends Record<string, unknown> {
  place: string;
  /** Page (region id) each card opens. */
  pages: { printers?: string; nodes?: string; network?: string };
}

const timers = new WeakMap<HTMLElement, ReturnType<typeof setInterval>>();

function tickClock(body: HTMLElement): void {
  const paint = () => {
    const now = new Date();
    const time = body.querySelector(".home-time");
    const date = body.querySelector(".home-date");
    if (time) time.textContent = clockOf(now.toISOString());
    if (date) date.textContent = now.toLocaleDateString("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric" }).toUpperCase();
  };
  paint();
  if (!timers.has(body)) timers.set(body, setInterval(paint, 1_000));
}

export const homeModule: ModuleManifest<HomeModel, HomeSettings> = {
  id: "lab-home",
  title: "HOME",
  description: "Base screen for small touch displays: clock, date, weather, and printer / machine / network summaries that open their pages.",
  version: "1.0.0",
  defaults: { place: "LAB", pages: { printers: "printers", nodes: "network", network: "network" } },
  sources: [PRINTERS_SOURCE, NODE_STATUS_SOURCE, LAB_NODE_SOURCE, WEATHER_SOURCE, LOCAL_OPS_SOURCE],

  model(ctx) {
    const lab = parseLab(ctx.sources.printers?.data, ctx.now);
    const nodes = parseNodes(ctx.sources["node-status"]?.data, ctx.now, []);
    const net = parseLabNode(ctx.sources["lab-node"]?.data, ctx.now);
    const weather = parseWeather(ctx.sources.weather?.data, ctx.sources["local-ops"]?.data);
    const pages = ctx.settings.pages ?? {};
    const online = nodes.nodes.filter((n) => n.state === "ONLINE").length;
    const physical = net.ifaces.filter((i) => i.kind === "ethernet" || i.kind === "wifi");
    const sum = (key: "rxBps" | "txBps") => physical.reduce<number | null>((t, i) => (i[key] === null ? t : (t ?? 0) + i[key]!), null);
    const finishing = lab.devices.filter((d) => d.job?.remaining !== null && d.job?.remaining !== undefined && ["printing", "cutting"].includes(d.state))
      .sort((a, b) => a.job!.remaining! - b.job!.remaining!)[0];
    return {
      place: String(ctx.settings.place || "LAB").toUpperCase(),
      temp: weather.temp,
      condition: weather.condition,
      cards: [
        {
          key: "printers", label: "PRINTERS", page: pages.printers ?? null,
          value: lab.status === "NO FEED" ? "—" : `${lab.active}/${lab.devices.length}`,
          detail: lab.status === "NO FEED" ? "No printer feed" : lab.errors ? `${lab.errors} need attention`
            : finishing ? `${finishing.name} · ${Math.max(1, Math.round(finishing.job!.remaining! / 60))} min left` : lab.active ? "Working" : "All idle",
          tone: lab.status === "NO FEED" ? "muted" : lab.errors ? "bad" : lab.status === "STALE" ? "warn" : lab.active ? "info" : "good",
        },
        {
          key: "nodes", label: "MACHINES", page: pages.nodes ?? null,
          value: nodes.status === "NO FEED" ? "—" : `${online}/${nodes.nodes.length}`,
          detail: nodes.status === "NO FEED" ? "No node feed" : online === nodes.nodes.length ? "All online"
            : `${nodes.nodes.filter((n) => n.state !== "ONLINE").map((n) => n.name).slice(0, 2).join(", ")} not online`,
          tone: nodes.status === "NO FEED" ? "muted" : online === nodes.nodes.length ? "good" : "warn",
        },
        {
          key: "network", label: "NETWORK", page: pages.network ?? null,
          value: net.status === "NO FEED" ? "—" : `▼ ${rateText(sum("rxBps"))}`,
          detail: net.status === "NO FEED" ? "Waiting for LabPi1" : net.status === "UNREACHABLE" ? "LabPi1 unreachable" : `▲ ${rateText(sum("txBps"))}`,
          tone: net.status === "LIVE" ? "info" : net.status === "NO FEED" ? "muted" : "bad",
        },
      ],
    };
  },

  render(body, m) {
    const hero = el("div", "home-hero");
    const clock = el("div", "home-clock");
    const time = el("b", "home-time");
    clock.append(time);
    const left = el("div", "home-when");
    left.append(clock, el("span", "home-date"));
    const wx = el("div", "home-wx");
    wx.append(el("span", "home-place", m.place), el("b", "", m.temp === null ? "—" : `${Math.round(m.temp)}°`), el("small", "", m.condition ?? ""));
    hero.append(left, wx);
    const cards = el("div", "home-cards");
    cards.append(...m.cards.map((c) => {
      const card = el("button", "home-card");
      card.type = "button";
      setTone(card, c.tone);
      card.append(el("span", "", c.label), el("b", "", c.value), el("small", "", c.detail));
      if (c.page) {
        card.addEventListener("click", (event) => {
          event.stopPropagation();
          body.dispatchEvent(new CustomEvent("console-page", { bubbles: true, detail: c.page }));
        });
      } else card.disabled = true;
      return card;
    }));
    body.replaceChildren(hero, cards);
    tickClock(body);
  },

  chip: () => ({ label: "TAP A TILE", tone: "muted" }),

  demo(now) {
    return { ...labModule.demo!(now), ...nodesModule.demo!(now), ...demoLabNode(now), ...demoWeather(now) };
  },
};
