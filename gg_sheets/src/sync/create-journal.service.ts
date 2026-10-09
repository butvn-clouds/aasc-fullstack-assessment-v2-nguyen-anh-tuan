import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'fs';
import { dirname, join } from 'path';

interface CreateEntry {
  hash: string;
  leadId?: string;
}

/** Write-ahead journal: không lưu payload khách hàng. Phải ghi đĩa thành công trước khi tạo CRM.
 * Cùng với sync lock, thiết kế này dành cho một process/volume bền vững.
 * Dòng chưa xác định kết quả không được tạo lại mù quáng sau restart. */
@Injectable()
export class CreateJournalService {
  private readonly path: string;
  private readonly scope: string;
  private entries?: Record<string, CreateEntry>;

  constructor(config: ConfigService) {
    this.path = join(
      config.get<string>('SYNC_HISTORY_DIR', join(process.cwd(), 'data')),
      'create-journal.json',
    );
    this.scope = createHash('sha256')
      .update(
        JSON.stringify([
          config.get('google.sheetId', ''),
          config.get('google.worksheetName', ''),
          // Portal là một phần identity; không lưu webhook/token vào journal.
          new URL(config.get<string>('BITRIX24_WEBHOOK_URL', 'https://unconfigured.invalid'))
            .origin,
        ]),
      )
      .digest('hex');
  }

  private key(row: number): string {
    return `${this.scope}:${row}`;
  }

  private load(): Record<string, CreateEntry> {
    if (this.entries) return this.entries;
    try {
      const parsed = existsSync(this.path) ? JSON.parse(readFileSync(this.path, 'utf8')) : {};
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed) ||
        Object.entries(parsed).some(
          ([key, value]: [string, any]) =>
            !/^[a-f0-9]{64}:\d+$/.test(key) ||
            !value ||
            typeof value.hash !== 'string' ||
            (value.leadId !== undefined && !/^[1-9]\d*$/.test(value.leadId)),
        )
      )
        throw new Error('invalid journal');
      this.entries = parsed;
      return parsed;
    } catch {
      throw new Error('RECOVERY_STORAGE_ERROR');
    }
  }

  private save(next: Record<string, CreateEntry>): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.tmp`;
      const fd = openSync(temporary, 'w', 0o600);
      try {
        writeFileSync(fd, JSON.stringify(next));
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(temporary, this.path);
      this.entries = next;
    } catch {
      throw new Error('RECOVERY_STORAGE_ERROR');
    }
  }

  lookup(row: number, hash: string, linkedId?: string): CreateEntry | undefined {
    const entry = this.load()[this.key(row)];
    if (!entry) {
      if (
        Object.entries(this.load()).some(
          ([key, value]) => key.startsWith(`${this.scope}:`) && value.hash === hash,
        )
      )
        throw new Error('RECOVERY_ROW_CHANGED');
      return undefined;
    }
    if (entry.leadId && linkedId && entry.leadId !== linkedId)
      throw new Error('RECOVERY_ROW_CHANGED');
    // ID do admin đối chiếu và điền là cách xác nhận kết quả không rõ; vẫn giữ journal
    // đến khi Sheet ghi thành công, không xóa chỉ vì người dùng đã nhập ID.
    if (linkedId) return { ...entry, leadId: linkedId };
    if (entry.hash !== hash) throw new Error('RECOVERY_ROW_CHANGED');
    return { ...entry };
  }

  begin(items: Array<{ rowNumber: number; hash: string }>): void {
    if (!items.length) return;
    const next = { ...this.load() };
    for (const item of items) {
      if (next[this.key(item.rowNumber)]) throw new Error('RECOVERY_UNCERTAIN');
      next[this.key(item.rowNumber)] = { hash: item.hash };
    }
    this.save(next);
  }

  confirm(row: number, leadId: string): void {
    const entries = this.load();
    const entry = entries[this.key(row)];
    if (!entry || !/^[1-9]\d*$/.test(leadId)) throw new Error('RECOVERY_STORAGE_ERROR');
    this.save({ ...entries, [this.key(row)]: { ...entry, leadId } });
  }

  acknowledge(rows: number[]): void {
    const next = { ...this.load() };
    let changed = false;
    for (const row of rows)
      if (next[this.key(row)]) {
        delete next[this.key(row)];
        changed = true;
      }
    if (changed) this.save(next);
  }
}
