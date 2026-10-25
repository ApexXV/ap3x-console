import { asDict, num, rows, sinceMs, text } from "../../core/format";

/* AP3X-LAB-NODE-1: LabPi1's health and network throughput, polled from its agent by a rackmain1
 * collector. Interface names and rates only; no addresses, hostnames of other devices, or MACs. */

export const LAB_NODE_SOURCE = {
  id: "lab-node", url: "/lab-node-data/current.json", schema: "AP3X-LAB-NODE-1",
  stampField: "generated_at", maxAgeMs: 2 * 60_000, optional: true,
};

export type IfaceKind = "ethernet" | "wifi" | "tailnet" | "other";

export interface Iface {
  name: string; kind: IfaceKind; up: boolean;
  rxBps: number | null; txBps: number | null; rxTotal: number | null; txTotal: number | null;
}

export interface Series { stepS: number; rx: number[]; tx: number[] }

export interface LabNode {
  status: "LIVE" | "STALE" | "UNREACHABLE" | "NO FEED";
  node: string;
  ageMs: number | null;
  lastSuccess: string | null;
  system: {
    uptimeS: number | null; load1: number | null; cores: number | null; cpuTempC: number | null; nvmeTempC: number | null;
    memUsedPct: number | null; memTotalGb: number | null; throttled: boolean | null; fanRpm: number | null;
    disks: { mount: string; usedPct: number | null; totalGb: number | null }[];
  };
  ifaces: Iface[];
  /** Combined physical interfaces (ethernet + wifi), bytes per second. */
  history: Series;
  router: { source: string; rxBps: number | null; txBps: number | null; history: Series } | null;
}

const STALE_MS = 2 * 60_000;
const KINDS = new Set<IfaceKind>(["ethernet", "wifi", "tailnet", "other"]);

function series(value: unknown): Series {
  const s = asDict(value);
  const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => num(x) ?? 0).slice(-120) : []);
  return { stepS: num(s.step_s) ?? 10, rx: list(s.rx_bps), tx: list(s.tx_bps) };
}

export function parseLabNode(payload: unknown, now: number): LabNode {
  const feed = asDict(payload);
  const empty: LabNode = {
    status: "NO FEED", node: "LABPI1", ageMs: null, lastSuccess: null,
    system: { uptimeS: null, load1: null, cores: null, cpuTempC: null, nvmeTempC: null, memUsedPct: null, memTotalGb: null, throttled: null, fanRpm: null, disks: [] },
    ifaces: [], history: { stepS: 10, rx: [], tx: [] }, router: null,
  };
  if (feed.schema_version !== "AP3X-LAB-NODE-1") return empty;
  const sys = asDict(feed.system);
  const ageMs = sinceMs(feed.generated_at, now);
  const reachable = text(feed.state)?.toUpperCase() !== "UNREACHABLE";
  const router = asDict(feed.router);
  return {
    status: ageMs === null || ageMs > STALE_MS ? "STALE" : reachable ? "LIVE" : "UNREACHABLE",
    node: (text(feed.node) ?? "labpi1").toUpperCase(),
    ageMs,
    lastSuccess: text(feed.last_success),
    system: {
      uptimeS: num(sys.uptime_s), load1: num(sys.load1), cores: num(sys.cores), cpuTempC: num(sys.cpu_temp_c), nvmeTempC: num(sys.nvme_temp_c),
      memUsedPct: num(sys.mem_used_pct), memTotalGb: num(sys.mem_total_gb),
      throttled: typeof sys.throttled === "boolean" ? sys.throttled : null, fanRpm: num(sys.fan_rpm),
      disks: rows(sys.disks).map((d) => ({ mount: text(d.mount) ?? "?", usedPct: num(d.used_pct), totalGb: num(d.total_gb) })),
    },
    ifaces: rows(feed.interfaces).map((i) => {
      const kind = (text(i.kind)?.toLowerCase() ?? "other") as IfaceKind;
      return {
        name: text(i.name) ?? "?", kind: KINDS.has(kind) ? kind : "other", up: i.up === true,
        rxBps: num(i.rx_bps), txBps: num(i.tx_bps), rxTotal: num(i.rx_total_bytes), txTotal: num(i.tx_total_bytes),
      };
    }),
    history: series(feed.history),
    router: Object.keys(router).length
      ? { source: text(router.source) ?? "ROUTER", rxBps: num(router.rx_bps), txBps: num(router.tx_bps), history: series(router.history) }
      : null,
  };
}

/** Bytes per second → bits per second text ("12.4 Mb/s"). Network rates read in bits. */
export function rateText(bytesPerSecond: number | null): string {
  if (bytesPerSecond === null) return "—";
  const bits = bytesPerSecond * 8;
  if (bits < 1_000) return `${Math.round(bits)} b/s`;
  const units = ["Kb/s", "Mb/s", "Gb/s"];
  let value = bits / 1_000;
  let unit = 0;
  while (value >= 1_000 && unit < units.length - 1) { value /= 1_000; unit += 1; }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export const tempTone = (c: number | null): "good" | "warn" | "bad" | "muted" => (c === null ? "muted" : c >= 80 ? "bad" : c >= 70 ? "warn" : "good");
export const pctTone = (p: number | null): "good" | "warn" | "bad" | "muted" => (p === null ? "muted" : p >= 90 ? "bad" : p >= 75 ? "warn" : "good");
