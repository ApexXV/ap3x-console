import type { ChangeEvent } from "./types";

export interface LoggedChange extends ChangeEvent {
  at: number;
  first: number;
  count: number;
}

const key = (c: ChangeEvent) => `${c.kicker}\u0000${c.text}`;

/**
 * Today's changes, newest first. The same change happening again bumps one
 * entry's count and time instead of adding a line (a flapping feed shows "×3").
 */
export class ChangeLog {
  private items: LoggedChange[] = [];

  constructor(private max = 200) {}

  add(events: ChangeEvent[], at: number): LoggedChange[] {
    for (const event of events) {
      const index = this.items.findIndex((c) => key(c) === key(event));
      const earlier = index >= 0 ? this.items.splice(index, 1)[0] : undefined;
      this.items.unshift({ ...event, at, first: earlier?.first ?? at, count: (earlier?.count ?? 0) + 1 });
    }
    this.items = this.items.slice(0, this.max);
    return events.map((e) => this.items.find((c) => key(c) === key(e))!);
  }

  clear(): void {
    this.items = [];
  }

  get entries(): readonly LoggedChange[] {
    return this.items;
  }

  get total(): number {
    return this.items.reduce((sum, c) => sum + c.count, 0);
  }

  toJSON(): LoggedChange[] {
    return this.items;
  }

  static from(saved: unknown, max = 200): ChangeLog {
    const log = new ChangeLog(max);
    if (Array.isArray(saved)) {
      log.items = saved.filter((c): c is LoggedChange => Boolean(c) && typeof c === "object" &&
        typeof (c as LoggedChange).text === "string" && typeof (c as LoggedChange).kicker === "string" &&
        typeof (c as LoggedChange).at === "number").slice(0, max);
    }
    return log;
  }
}
