import { ConflictException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeSync,
} from 'fs';
import { hostname } from 'os';
import { dirname, join } from 'path';

/** Khóa liên tiến trình dựa trên tệp (O_EXCL). Bảo vệ server + CLI + nhiều container dùng chung MỘT volume.
 * Không thay thế khóa phân tán (Redis/DB) khi các bản sao chạy trên máy khác nhau và không chung ổ đĩa. */
export interface FileLockOptions {
  path: string;
  /** Sau ngần này ms không được gia hạn (heartbeat), khóa bị coi là của tiến trình đã chết. */
  ttlMs: number;
  now?: () => number;
}

export interface FileLockHandle {
  release(): void;
}

const LOCKED_MESSAGE =
  'SYNC_LOCKED: đang có tiến trình đồng bộ khác (server/CLI/container) chạy trên cùng dữ liệu. Chờ nó hoàn tất rồi thử lại.';

/** Lấy khóa hoặc ném ConflictException(409). Khóa cũ quá hạn được thu hồi. */
export function acquireFileLock(options: FileLockOptions): FileLockHandle {
  const now = options.now ?? Date.now;
  const token = randomBytes(12).toString('hex');
  mkdirSync(dirname(options.path), { recursive: true });

  const tryCreate = (): boolean => {
    try {
      const fd = openSync(options.path, 'wx', 0o600);
      try {
        writeSync(fd, JSON.stringify({ token, pid: process.pid, host: hostname(), at: now() }));
      } finally {
        closeSync(fd);
      }
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw error;
    }
  };

  if (!tryCreate()) {
    // Thu hồi khóa quá hạn: đọc lại mtime ngay trước khi xóa để không xóa nhầm khóa mới.
    let stale = false;
    let before = 0;
    try {
      before = statSync(options.path).mtimeMs;
      stale = now() - before > options.ttlMs;
    } catch {
      stale = true; // Khóa vừa được nhả giữa hai bước.
    }
    if (!stale) throw new ConflictException(LOCKED_MESSAGE);
    try {
      if (statSync(options.path).mtimeMs === before) unlinkSync(options.path);
    } catch {
      /* đã bị tiến trình khác dọn */
    }
    if (!tryCreate()) throw new ConflictException(LOCKED_MESSAGE);
  }

  // Heartbeat: gia hạn mtime để khóa của tiến trình còn sống không bao giờ bị coi là quá hạn.
  const beat = setInterval(
    () => {
      try {
        const t = new Date(now());
        utimesSync(options.path, t, t);
      } catch {
        /* nếu tệp bị xóa, release() sẽ bỏ qua */
      }
    },
    Math.max(1000, Math.floor(options.ttlMs / 3)),
  );
  beat.unref();

  return {
    release() {
      clearInterval(beat);
      try {
        // Chỉ xóa khóa của chính mình.
        if (JSON.parse(readFileSync(options.path, 'utf8')).token === token)
          unlinkSync(options.path);
      } catch {
        /* đã được nhả hoặc thu hồi */
      }
    },
  };
}

let tail: Promise<unknown> = Promise.resolve();

function defaultLockOptions(): FileLockOptions | undefined {
  // Test tự chạy song song nhiều process trên cùng thư mục; khóa tệp được kiểm thử riêng qua acquireFileLock.
  if (process.env.SYNC_FILE_LOCK === 'false') return undefined;
  if (process.env.NODE_ENV === 'test' && process.env.SYNC_FILE_LOCK !== 'true') return undefined;
  const dir = process.env.SYNC_HISTORY_DIR ?? join(process.cwd(), 'data');
  return {
    path: join(dir, 'sync.lock'),
    ttlMs: Number(process.env.SYNC_LOCK_TTL_MS ?? 10 * 60_000),
  };
}

/** Tuần tự hóa mọi thao tác ghi: hàng đợi trong process (HTTP/cron/webhook) + khóa tệp giữa các process. */
export function withSyncLock<T>(work: () => Promise<T>): Promise<T> {
  const next = tail.then(async () => {
    const options = defaultLockOptions();
    const handle = options ? acquireFileLock(options) : undefined;
    try {
      return await work();
    } finally {
      handle?.release();
    }
  });
  tail = next.catch(() => undefined);
  return next;
}
