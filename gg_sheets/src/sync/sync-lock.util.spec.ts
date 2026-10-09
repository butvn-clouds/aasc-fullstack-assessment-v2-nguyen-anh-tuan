import { ConflictException } from '@nestjs/common';
import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { acquireFileLock, withSyncLock } from './sync-lock.util';

describe('cross-process sync lock', () => {
  let dir: string;
  let path: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sync-lock-'));
    path = join(dir, 'sync.lock');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('rejects a second holder with 409 while the first is alive', () => {
    const first = acquireFileLock({ path, ttlMs: 60_000 });
    expect(() => acquireFileLock({ path, ttlMs: 60_000 })).toThrow(ConflictException);
    first.release();
    const again = acquireFileLock({ path, ttlMs: 60_000 });
    again.release();
    expect(existsSync(path)).toBe(false);
  });

  it('reclaims a stale lock left by a crashed process', () => {
    writeFileSync(path, JSON.stringify({ token: 'dead', pid: 1 }));
    const old = new Date(Date.now() - 3_600_000);
    utimesSync(path, old, old);
    const handle = acquireFileLock({ path, ttlMs: 60_000 });
    expect(existsSync(path)).toBe(true);
    handle.release();
    expect(existsSync(path)).toBe(false);
  });

  it('does not steal a fresh lock nor delete a lock it does not own on release', () => {
    const owner = acquireFileLock({ path, ttlMs: 60_000 });
    expect(() => acquireFileLock({ path, ttlMs: 60_000 })).toThrow('SYNC_LOCKED');
    writeFileSync(path, JSON.stringify({ token: 'someone-else' }));
    owner.release();
    expect(existsSync(path)).toBe(true); // không xóa khóa của người khác
  });

  it('still serialises in-process work and releases after a failure', async () => {
    const order: string[] = [];
    const a = withSyncLock(async () => {
      order.push('a1');
      await new Promise((r) => setTimeout(r, 20));
      order.push('a2');
    });
    const b = withSyncLock(async () => {
      order.push('b');
      throw new Error('boom');
    });
    await a;
    await expect(b).rejects.toThrow('boom');
    await withSyncLock(async () => order.push('c'));
    expect(order).toEqual(['a1', 'a2', 'b', 'c']);
  });

  it('withSyncLock enforces the file lock when enabled', async () => {
    process.env.SYNC_FILE_LOCK = 'true';
    process.env.SYNC_HISTORY_DIR = dir;
    try {
      const other = acquireFileLock({ path, ttlMs: 60_000 }); // "tiến trình khác" đang giữ khóa
      await expect(withSyncLock(async () => 1)).rejects.toThrow(ConflictException);
      other.release();
      await expect(withSyncLock(async () => 1)).resolves.toBe(1);
      expect(existsSync(path)).toBe(false);
    } finally {
      delete process.env.SYNC_FILE_LOCK;
      delete process.env.SYNC_HISTORY_DIR;
    }
  });
});
