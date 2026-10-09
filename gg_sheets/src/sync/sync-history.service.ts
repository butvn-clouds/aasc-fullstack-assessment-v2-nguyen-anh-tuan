import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import { publicError } from '../common/public-error';

export interface RunRecord {
  id: string;
  direction: string;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'success' | 'partial' | 'failed' | 'interrupted';
  summary?: Record<string, number>;
  error?: { code: string; message: string };
  details?: Array<{ rowNumber?: number; code: string; message: string }>;
}

@Injectable()
export class SyncHistoryService implements OnModuleInit {
  private readonly logger = new Logger(SyncHistoryService.name);
  private records: RunRecord[] = [];
  private path: string;
  private persistenceError = false;
  constructor(config: ConfigService) {
    this.path = join(
      config.get<string>('SYNC_HISTORY_DIR', join(process.cwd(), 'data')),
      'sync-history.json',
    );
  }
  onModuleInit() {
    try {
      if (existsSync(this.path)) {
        const records = JSON.parse(readFileSync(this.path, 'utf8'));
        if (!Array.isArray(records)) throw new Error('invalid history');
        this.records = records
          .slice(-100)
          .map((record) =>
            record.status === 'running' ? { ...record, status: 'interrupted' } : record,
          );
      }
    } catch {
      this.persistenceError = true;
      this.logger.warn('Không đọc được lịch sử; kiểm tra file data/sync-history.json.');
    }
  }
  list() {
    return { runs: [...this.records].reverse(), persistenceError: this.persistenceError };
  }
  private persist() {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path + '.tmp', JSON.stringify(this.records), { mode: 0o600 });
      renameSync(this.path + '.tmp', this.path);
      this.persistenceError = false;
    } catch {
      this.persistenceError = true;
      this.logger.warn('Không lưu được lịch sử; không thử chạy lại job chỉ vì lỗi lưu log.');
    }
  }
  async track<T>(direction: string, work: () => Promise<T>): Promise<T> {
    const entry: RunRecord = {
      id: randomUUID(),
      direction,
      startedAt: new Date().toISOString(),
      status: 'running',
    };
    this.records.push(entry);
    this.records = this.records.slice(-100);
    this.persist();
    try {
      const result = await work();
      const values = result as Record<string, unknown>;
      entry.summary = Object.fromEntries(
        [
          'totalRows',
          'totalChecked',
          'created',
          'updated',
          'pulledDown',
          'skipped',
          'conflicts',
          'errors',
        ]
          .filter((key) => typeof values[key] === 'number')
          .map((key) => [key, values[key] as number]),
      );
      entry.status = Number(values.errors) > 0 ? 'partial' : 'success';
      if (Array.isArray(values.errorDetails))
        entry.details = values.errorDetails.slice(0, 50).map((detail) => ({
          rowNumber: typeof detail.rowNumber === 'number' ? detail.rowNumber : undefined,
          ...publicError(new Error(String(detail.message ?? ''))),
        }));
      return result;
    } catch (error) {
      entry.status = 'failed';
      entry.error = publicError(error);
      throw error;
    } finally {
      entry.finishedAt = new Date().toISOString();
      this.persist();
    }
  }
}
