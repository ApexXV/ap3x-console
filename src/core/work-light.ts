import { el } from "./dom";
import type { RunMode } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type Timer = ReturnType<typeof setTimeout>;
interface LightState { enabled: boolean; applied: boolean; requestId: string | null }
interface Operation { enabled: boolean; requestId: string | null }
interface Request { controller: AbortController; timer?: Timer; expired: boolean }
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** A fixed Office-only mode control. HTTP acceptance never substitutes for lamp feedback. */
export class OfficeWorkLight {
  readonly element = el("button", "icon-toggle work-light-toggle");
  readonly status = el("span", "work-light-status");
  private badge = el("span", "work-light-mode", "—");
  private active = false;
  private listening = false;
  private destroyed = false;
  private epoch = 0;
  private payload: unknown = null;
  private pending: Operation | null = null;
  private error = "";
  private pollTimer?: Timer;
  private staleTimer?: Timer;
  private confirmTimer?: Timer;
  private statusRequest: Request | null = null;
  private commandRequest: Request | null = null;
  private pollAgain = false;
  private onHide = () => this.suspend();
  private onShow = () => { if (this.listening) this.resume(); };
  private onClick = (event: MouseEvent) => { event.stopPropagation(); void this.change(); };

  constructor(private mode: RunMode) {
    this.element.type = "button";
    this.element.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6m-5 3h4M8.1 13.4a6 6 0 1 1 7.8 0c-1 .8-1.4 1.7-1.4 2.6h-5c0-.9-.4-1.8-1.4-2.6Z"/></svg>';
    this.badge.setAttribute("aria-hidden", "true");
    this.element.append(this.badge);
    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-live", "polite");
    this.status.setAttribute("aria-atomic", "true");
    this.element.addEventListener("click", this.onClick);
    this.render();
  }

  /** Call after mounting element and status. No network is started by construction. */
  start(): void {
    if (this.destroyed) return;
    if (!this.listening) {
      window.addEventListener("pagehide", this.onHide);
      window.addEventListener("pageshow", this.onShow);
      this.listening = true;
    }
    this.resume();
  }

  /** Explicit stop also prevents a later pageshow from restarting this instance. */
  stop(): void {
    window.removeEventListener("pagehide", this.onHide);
    window.removeEventListener("pageshow", this.onShow);
    this.listening = false;
    this.suspend();
  }

  destroy(): void {
    this.stop();
    this.destroyed = true;
    this.element.removeEventListener("click", this.onClick);
  }

  private allowed(): boolean {
    return this.mode === "live" && !new URLSearchParams(location.search).has("demo") &&
      location.protocol === "http:" && location.hostname.toLowerCase() === "192.168.4.115" && location.port === "3098";
  }

  private state(): LightState | null {
    const lighting = record(record(this.payload)?.lighting);
    const work = record(lighting?.work_light);
    const stamp = typeof lighting?.updated_at === "string" ? Date.parse(lighting.updated_at) : NaN;
    const age = Date.now() - stamp;
    if (!lighting || lighting.available !== true || lighting.schema_version !== 1 ||
      !Number.isFinite(age) || age < -15000 || age > 20000 || !work ||
      work.available !== true || typeof work.enabled !== "boolean") return null;
    return { enabled: work.enabled, applied: work.applied === true,
      requestId: typeof work.request_id === "string" && UUID.test(work.request_id) ? work.request_id : null };
  }

  private clearConfirmation(): void {
    clearTimeout(this.confirmTimer);
    this.confirmTimer = undefined;
  }

  private render(): void {
    const reported = this.state();
    if (this.pending?.requestId && reported?.requestId === this.pending.requestId &&
      reported.enabled === this.pending.enabled && reported.applied) {
      this.pending = null;
      this.error = "";
      this.clearConfirmation();
    }
    let text: string, label: string, kind: string;
    if (!this.allowed()) {
      text = "—"; kind = "unavailable";
      label = this.mode === "demo" || new URLSearchParams(location.search).has("demo")
        ? "Office light disabled in demo mode"
        : "Office light control unavailable here. Open http://192.168.4.115:3098/console/index.html?layout=command-57";
    } else if (this.pending) {
      text = "…"; kind = "pending";
      label = this.pending.enabled ? "Setting office work light to full cool white" : "Restoring automatic office lighting";
    } else if (this.error) {
      text = "!"; kind = "error";
      label = this.error + (reported ? ` Current reported mode: ${reported.enabled ? "Work" : "Auto"}. Activate to switch mode.` : " Current mode unknown.");
    } else if (!reported || !this.active) {
      text = "—"; kind = "unavailable";
      label = "Office light control unavailable; current mode unknown";
    } else {
      text = (reported.enabled ? "WORK" : "AUTO") + (reported.applied ? "" : "*");
      kind = reported.applied ? (reported.enabled ? "work" : "auto") : "unconfirmed";
      label = reported.enabled ? "Office work light selected; full cool white" : "Automatic office lighting selected";
      label += reported.applied ? ". " : "; lamp setting not confirmed. ";
      label += reported.enabled ? "Switch to automatic lighting" : "Switch on full cool-white work light";
    }
    this.badge.textContent = text;
    this.element.dataset.state = kind;
    this.element.disabled = !this.allowed() || !this.active || !!this.pending || !reported;
    this.element.setAttribute("aria-label", label);
    this.element.title = label;
    this.element.setAttribute("aria-busy", String(!!this.pending));
    if (this.allowed() && reported) {
      this.element.setAttribute("role", "switch");
      this.element.setAttribute("aria-checked", String(reported.enabled));
    } else {
      this.element.removeAttribute("role");
      this.element.removeAttribute("aria-checked");
    }
    if (this.status.textContent !== label) this.status.textContent = label;
  }

  private fail(message: string): void {
    this.pending = null;
    this.error = message;
    this.clearConfirmation();
    this.render();
  }

  private receive(value: unknown): void {
    this.payload = value;
    clearTimeout(this.staleTimer);
    this.staleTimer = undefined;
    if (this.state()) {
      const stamp = record(record(value)?.lighting)?.updated_at as string;
      this.staleTimer = setTimeout(() => { this.staleTimer = undefined; this.render(); },
        Math.max(0, Date.parse(stamp) + 20001 - Date.now()));
    }
    this.render();
  }

  private schedulePoll(delay: number): void {
    clearTimeout(this.pollTimer);
    this.pollTimer = undefined;
    if (!this.active || !this.allowed() || this.statusRequest) return;
    this.pollTimer = setTimeout(() => { this.pollTimer = undefined; void this.poll(); }, delay);
  }

  private pollNow(): void {
    if (!this.active || !this.allowed()) return;
    if (this.statusRequest) { this.pollAgain = true; return; }
    clearTimeout(this.pollTimer);
    this.pollTimer = undefined;
    void this.poll();
  }

  private async poll(): Promise<void> {
    if (!this.active || !this.allowed() || this.statusRequest) return;
    const generation = this.epoch;
    const request: Request = { controller: new AbortController(), expired: false };
    this.statusRequest = request;
    request.timer = setTimeout(() => {
      request.expired = true;
      request.controller.abort();
      if (this.active && this.epoch === generation && this.statusRequest === request) this.receive(null);
    }, 4000);
    this.render();
    try {
      const response = await fetch("/office-ai/status", { method: "GET", credentials: "same-origin",
        cache: "no-store", signal: request.controller.signal, headers: { Accept: "application/json" } });
      if (response.status !== 200) throw new Error("Status unavailable");
      const value: unknown = await response.json();
      if (this.active && this.epoch === generation && this.statusRequest === request && !request.expired) this.receive(value);
    } catch {
      if (this.active && this.epoch === generation && this.statusRequest === request) this.receive(null);
    } finally {
      clearTimeout(request.timer);
      if (this.statusRequest === request) {
        this.statusRequest = null;
        if (this.active && this.epoch === generation) {
          const immediate = this.pollAgain;
          this.pollAgain = false;
          this.schedulePoll(immediate ? 0 : this.pending ? 1000 : 5000);
        }
      }
    }
  }

  private async change(): Promise<void> {
    const before = this.state();
    if (!this.active || !this.allowed() || this.pending || this.commandRequest || !before) return;
    const generation = this.epoch;
    const operation: Operation = { enabled: !before.enabled, requestId: null };
    const request: Request = { controller: new AbortController(), expired: false };
    this.pending = operation;
    this.commandRequest = request;
    this.error = "";
    this.render();
    this.schedulePoll(1000);
    request.timer = setTimeout(() => {
      request.controller.abort();
      if (this.active && this.epoch === generation && this.pending === operation) this.fail("Change not confirmed; check the light.");
    }, 8000);
    try {
      const response = await fetch("/office-ai/work-light", { method: "POST", credentials: "same-origin",
        cache: "no-store", signal: request.controller.signal,
        headers: { "Content-Type": "application/json", "X-Office-Control": "work-light" },
        body: JSON.stringify({ enabled: operation.enabled }) });
      if (!this.active || this.epoch !== generation || this.pending !== operation) return;
      if (response.status !== 202) {
        this.fail(response.status === 429 ? "Please wait, then try again." : response.status === 409 ? "Lighting is busy; try again."
          : response.status === 503 ? "Light control unavailable." : "Change not confirmed; check the light.");
        return;
      }
      const ack = record(await response.json());
      if (!this.active || this.epoch !== generation || this.pending !== operation) return;
      if (!ack || ack.accepted !== true || ack.enabled !== operation.enabled ||
        typeof ack.request_id !== "string" || !UUID.test(ack.request_id)) {
        this.fail("Change not confirmed; check the light.");
        return;
      }
      operation.requestId = ack.request_id;
      this.confirmTimer = setTimeout(() => {
        if (this.active && this.epoch === generation && this.pending === operation) this.fail("Change not confirmed; check the light.");
      }, 20000);
      this.render();
    } catch {
      if (this.active && this.epoch === generation && this.pending === operation) this.fail("Change not confirmed; check the light.");
    } finally {
      clearTimeout(request.timer);
      if (this.commandRequest === request) this.commandRequest = null;
      if (this.active && this.epoch === generation) this.pollNow();
    }
  }

  private suspend(): void {
    if (!this.active) return;
    this.active = false;
    this.epoch += 1;
    clearTimeout(this.pollTimer);
    clearTimeout(this.staleTimer);
    this.pollTimer = this.staleTimer = undefined;
    this.clearConfirmation();
    if (this.statusRequest) { clearTimeout(this.statusRequest.timer); this.statusRequest.controller.abort(); }
    if (this.commandRequest) { clearTimeout(this.commandRequest.timer); this.commandRequest.controller.abort(); }
    this.statusRequest = this.commandRequest = null;
    this.pollAgain = false;
    if (this.pending) this.error = "Change not confirmed; check the light.";
    this.pending = null;
    this.payload = null;
    this.render();
  }

  private resume(): void {
    if (this.active || this.destroyed) return;
    this.active = true;
    this.epoch += 1;
    this.render();
    this.pollNow();
  }
}
