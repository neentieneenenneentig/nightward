// In-game activity/combat log — also our dev-visibility tool. A ring buffer
// so it can't grow unbounded across a long play session.
// N2: increased capacity for comprehensive logging + export support.
export type LogKind =
  | 'gather' | 'craft' | 'build' | 'combat' | 'boss' | 'level' | 'death'
  | 'region' | 'economy' | 'system' | 'spawn' | 'world' | 'network'
  | 'resonance-pulse' | 'resonance-flow' | 'resonance-flux' | 'resonance-echo' | 'resonance-link' | 'resonance-rift' | 'resonance';

export interface LogEntry {
  t: number;
  kind: LogKind;
  msg: string;
}

export class GameLog {
  entries: LogEntry[] = [];
  /** Total entries ever logged (not just buffer). */
  totalLogged = 0;
  constructor(private cap = 2000) {}

  push(kind: LogKind, msg: string, clock = 0) {
    this.entries.push({ t: clock, kind, msg });
    this.totalLogged++;
    if (this.entries.length > this.cap) this.entries.shift();
  }

  recent(n = 50) {
    return this.entries.slice(-n).reverse();
  }

  /** Export entire log as a formatted text string. */
  exportText(): string {
    const lines: string[] = [
      '========================================',
      '  NIGHTWARD — Full Session Log',
      `  Exported: ${new Date().toISOString()}`,
      `  Total entries: ${this.totalLogged}`,
      '========================================',
      '',
    ];
    for (const e of this.entries) {
      const t = Math.floor(e.t);
      const ts = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
      lines.push(`[${ts}] [${e.kind.toUpperCase().padEnd(10)}] ${e.msg}`);
    }
    return lines.join('\n');
  }

  /** Trigger a download of the log as a .txt file. */
  download(filename = 'nightward-log.txt') {
    const text = this.exportText();
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}
