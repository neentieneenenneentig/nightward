// In-game activity/combat log — also our dev-visibility tool. A ring buffer
// so it can't grow unbounded across a long play session.
export type LogKind =
  | 'gather' | 'craft' | 'build' | 'combat' | 'boss' | 'level' | 'death' | 'region' | 'economy' | 'system' | 'spawn';

export interface LogEntry {
  t: number;
  kind: LogKind;
  msg: string;
}

export class GameLog {
  entries: LogEntry[] = [];
  constructor(private cap = 500) {}

  push(kind: LogKind, msg: string, clock = 0) {
    this.entries.push({ t: clock, kind, msg });
    if (this.entries.length > this.cap) this.entries.shift();
  }

  recent(n = 50) {
    return this.entries.slice(-n).reverse();
  }
}
