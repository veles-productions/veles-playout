/**
 * As-Run Log — timestamped record of all on-air events.
 *
 * Broadcast compliance: records every TAKE, CLEAR, LOAD, FREEZE
 * with template ID, fields, and timing. Written as JSON Lines (.jsonl)
 * to userData/logs/ directory, one file per day.
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

export interface AsRunEntry {
  timestamp: string;
  event: 'load' | 'take' | 'clear' | 'freeze' | 'unfreeze' | 'update' | 'updatePgm' | 'error' | 'crash-recovery';
  templateId?: string;
  templateName?: string;
  variables?: Record<string, string>;
  duration?: number;
  details?: string;
}

export class AsRunLog {
  private logDir: string;
  private currentDate: string = '';
  private stream: fs.WriteStream | null = null;

  constructor() {
    this.logDir = path.join(app.getPath('userData'), 'logs');
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /** Append an event to today's log file */
  write(entry: Omit<AsRunEntry, 'timestamp'>): void {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD

    // Rotate file on date change
    if (dateStr !== this.currentDate) {
      this.closeStream();
      this.currentDate = dateStr;
      const filePath = path.join(this.logDir, `as-run-${dateStr}.jsonl`);
      this.stream = fs.createWriteStream(filePath, { flags: 'a' });
    }

    const full: AsRunEntry = {
      timestamp: now.toISOString(),
      ...entry,
    };

    if (this.stream) {
      this.stream.write(JSON.stringify(full) + '\n');
    }
  }

  /** Get the log directory path */
  getLogDir(): string {
    return this.logDir;
  }

  /** Close the current write stream */
  destroy(): void {
    this.closeStream();
  }

  private closeStream(): void {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
  }
}
