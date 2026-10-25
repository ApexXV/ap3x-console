import { el, setTone, sparkline } from "../../core/dom";
import { dlist, note, sec, stats } from "../../core/detail";
import { bytesText } from "../../core/format";
import type { ModuleManifest } from "../../core/types";
import { demoLabNode } from "../labnode/demo";
import { LAB_NODE_SOURCE, type LabNode, parseLabNode, rateText } from "../labnode/parse";
import { labNodeChip } from "../labnode";
import "./netio.css";

/* Network I/O: LabPi1's interfaces now; router-wide traffic when the feed carries a router block. */

const KIND_LABEL = { ethernet: "ETHERNET", wifi: "WI-FI", tailnet: "TAILSCALE", other: "OTHER" } as const;
const window_ = (m: LabNode) => `${Math.round((m.history.rx.length * m.history.stepS) / 60)} MIN`;

function rateBlock(label: string, value: number | null, tone: "info" | "good"): HTMLElement {
  const node = el("div", "net-rate");
  setTone(node, tone);
  node.append(el("span", "", label), el("b", "", rateText(value)));
  return node;
}

export const netIoModule: ModuleManifest<LabNode> = {
  id: "net-io",
  title: "NETWORK I/O",
  description: "Live download/upload rates and recent history for LabPi1's interfaces, and the lab router once connected.",
  version: "1.0.0",
  sources: [LAB_NODE_SOURCE],

  model: (ctx) => parseLabNode(ctx.sources["lab-node"]?.data, ctx.now),

  render(body, m) {
    if (m.status === "NO FEED") {
      body.replaceChildren(el("p", "empty", "Waiting for LabPi1's network figures"));
      return;
    }
    const physical = m.ifaces.filter((i) => i.kind === "ethernet" || i.kind === "wifi");
    const sum = (key: "rxBps" | "txBps") => physical.reduce<number | null>((total, i) => (i[key] === null ? total : (total ?? 0) + i[key]!), null);
    const head = el("div", "net-head");
    head.append(rateBlock("▼ DOWN", sum("rxBps"), "info"), rateBlock("▲ UP", sum("txBps"), "good"));
    const chart = el("div", "net-chart");
    chart.append(sparkline([{ values: m.history.rx, tone: "info", fill: true }, { values: m.history.tx, tone: "good" }], "LabPi1 throughput history"),
      el("small", "net-window", `LAST ${window_(m)}`));
    const links = el("ol", "net-links");
    links.append(...m.ifaces.map((i) => {
      const li = el("li");
      setTone(li, i.up ? (i.kind === "tailnet" ? "info" : "good") : "muted");
      li.append(el("i", "dot"), el("b", "", KIND_LABEL[i.kind]), el("span", "", i.up ? `${rateText(i.rxBps)} ▼ ${rateText(i.txBps)} ▲` : "DOWN"));
      return li;
    }));
    body.replaceChildren(head, chart, links);
  },

  chip: labNodeChip,

  detail(m) {
    const routerSection = m.router
      ? sec(`LAB ROUTER · ${m.router.source.toUpperCase()}`, stats([["DOWN", rateText(m.router.rxBps), "info"], ["UP", rateText(m.router.txBps), "good"]]))
      : sec("LAB ROUTER", note("Router-wide traffic isn't connected yet. Once the lab router's stats are readable, this shows the whole lab's traffic beside LabPi1's."));
    return {
      title: "NETWORK I/O",
      chip: labNodeChip(m),
      foot: "Rates are bits per second, sampled every 10 s by rackmain1 from LabPi1's interface counters",
      columns: "minmax(0, 1.4fr) minmax(0, 1fr)", rows: "minmax(0, 1fr) auto",
      sections: m.status === "NO FEED" ? [note("No network figures yet. Install LabPi1's agent and the lab-node collector.")] : [
        sec(`LABPI1 · LAST ${window_(m)}`, (() => {
          const chart = el("div", "net-chart is-large");
          chart.append(sparkline([{ values: m.history.rx, tone: "info", fill: true }, { values: m.history.tx, tone: "good" }], "LabPi1 throughput history"));
          return chart;
        })()),
        sec("INTERFACES", dlist(m.ifaces.map((i) => ({
          title: `${KIND_LABEL[i.kind]} · ${i.name}`,
          detail: i.up ? `${rateText(i.rxBps)} down · ${rateText(i.txBps)} up · ${bytesText(i.rxTotal)} / ${bytesText(i.txTotal)} since boot` : "Link down",
          tag: i.up ? "UP" : "DOWN", tone: i.up ? "good" : "muted",
        })))),
        routerSection,
      ],
    };
  },

  demo: demoLabNode,
};
