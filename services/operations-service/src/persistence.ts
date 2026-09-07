import { mkdirSync, existsSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { Store } from './store.js';

// Single-process edge checkpoint plus append-only source/audit archives.
// Not a distributed database: see docs/RELEASE_READINESS.md for crash windows.
export class FilePersistence {
  private path: string;
  private lock: string;
  private closed = false;
  constructor(private directory: string, private store: Store, private mode: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.path = join(directory, 'state.json'); this.lock = join(directory, 'writer.lock');
    if (existsSync(this.lock)) {
      const pid = Number(readFileSync(this.lock, 'utf8'));
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid writer lock; inspect before recovery');
      try { process.kill(pid, 0); throw new Error('DATA_DIR already has a live writer'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
      unlinkSync(this.lock);
    }
    const fd = openSync(this.lock, 'wx', 0o600);
    try { writeFileSync(fd, String(process.pid)); fsyncSync(fd); } finally { closeSync(fd); }
  }
  restore(): boolean {
    if (!existsSync(this.path)) return false;
    const saved = JSON.parse(readFileSync(this.path, 'utf8'));
    if (saved.authMode !== this.mode) throw new Error('Use a separate DATA_DIR for demo and OIDC');
    this.store.restoreState(saved.state);
    return true;
  }
  append(kind: 'raw' | 'audit', value: unknown): void {
    const path = join(this.directory, `${kind}-${new Date().toISOString().slice(0,10)}.jsonl`);
    const created = !existsSync(path);
    const fd = openSync(path, 'a', 0o600);
    try { writeFileSync(fd, JSON.stringify(value) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
    if (created) { const dir = openSync(this.directory, 'r'); try { fsyncSync(dir); } finally { closeSync(dir); } }
  }
  checkpoint(): void {
    const temp = this.path + '.tmp';
    const fd = openSync(temp, 'w', 0o600);
    try { writeFileSync(fd, JSON.stringify({ authMode: this.mode, state: this.store.exportState() })); fsyncSync(fd); }
    finally { closeSync(fd); }
    renameSync(temp, this.path);
    const dir = openSync(this.directory, 'r');
    try { fsyncSync(dir); } finally { closeSync(dir); }
  }
  close(): void {
    if (this.closed) return;
    this.checkpoint(); this.closed = true; unlinkSync(this.lock);
  }
}
