/** A plausible AP3X-LAB-NODE-1 payload for previews: quiet network with a short upload burst. */
export function demoLabNode(now: number): Record<string, unknown> {
  const wave = (base: number, burstAt: number, i: number) => Math.round(base * (1 + 0.35 * Math.sin(i / 4)) + (Math.abs(i - burstAt) < 4 ? base * 9 : 0));
  const rx = Array.from({ length: 60 }, (_, i) => wave(48_000, 44, i));
  const tx = Array.from({ length: 60 }, (_, i) => wave(21_000, 47, i));
  return {
    "lab-node": {
      schema_version: "AP3X-LAB-NODE-1",
      generated_at: new Date(now - 6_000).toISOString(),
      last_success: new Date(now - 6_000).toISOString(),
      node: "labpi1",
      state: "LIVE",
      system: {
        uptime_s: 3 * 86_400 + 4 * 3_600, load1: 0.18, cores: 4, cpu_temp_c: 47.2, nvme_temp_c: null,
        mem_used_pct: 9.4, mem_total_gb: 15.8, throttled: false, fan_rpm: 1450,
        disks: [{ mount: "/", used_pct: 6.1, total_gb: 116.8 }],
      },
      interfaces: [
        { name: "wlan0", kind: "wifi", up: true, rx_bps: rx.at(-1), tx_bps: tx.at(-1), rx_total_bytes: 8.2e9, tx_total_bytes: 2.9e9 },
        { name: "eth0", kind: "ethernet", up: false, rx_bps: 0, tx_bps: 0, rx_total_bytes: 0, tx_total_bytes: 0 },
        { name: "tailscale0", kind: "tailnet", up: true, rx_bps: 3_400, tx_bps: 5_100, rx_total_bytes: 3.1e8, tx_total_bytes: 4.4e8 },
      ],
      history: { step_s: 10, rx_bps: rx, tx_bps: tx },
      router: null,
    },
  };
}
