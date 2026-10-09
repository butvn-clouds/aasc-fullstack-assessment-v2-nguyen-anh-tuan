import { Injectable } from '@nestjs/common';
import { createWriteStream } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { stream as excelStream } from 'exceljs';
import { finished } from 'stream/promises';
import { AnalyticsService, csvRow } from './analytics.service';
import { LEAD_COLUMNS, excelValue } from './xlsx';
import { validateDateRange } from './date-range';

@Injectable()
export class ReportExportService {
  constructor(private readonly analytics: AnalyticsService) {}

  async *streamText(range: string, format: 'csv' | 'json', signal?: AbortSignal): AsyncGenerator<string> {
    validateDateRange(range);
    signal?.throwIfAborted();
    let columns: string[] | undefined;
    for await (const row of this.analytics.streamLeads(range, signal)) {
      signal?.throwIfAborted();
      const first = columns === undefined;
      columns ??= Object.keys(row);
      if (format === 'json') yield `${first ? '[' : ','}${JSON.stringify(row)}`;
      else yield `${first ? columns.join(',') + '\n' : '\n'}${csvRow(row, columns)}`;
    }
    if (format === 'json') yield columns ? ']' : '[]';
  }

  async createXlsx(range: string, signal?: AbortSignal) {
    validateDateRange(range);
    signal?.throwIfAborted();
    const directory = await mkdtemp(join(tmpdir(), 'tiktok-report-'));
    const path = join(directory, 'leads.xlsx');
    const dispose = () => rm(directory, { recursive: true, force: true });
    const output = createWriteStream(path);
    const completion = finished(output);
    // Giữ lỗi luồng để kiểm tra trong vòng lặp, tránh phát sinh lỗi promise không được xử lý.
    let outputError: unknown;
    void completion.catch((error: unknown) => {
      outputError = error;
    });
    const abort = () => output.destroy(new Error('Đã hủy xuất báo cáo'));
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const workbook = new excelStream.xlsx.WorkbookWriter({
        stream: output,
        useSharedStrings: false,
        useStyles: true,
      });
      const sheet = workbook.addWorksheet('Khách hàng tiềm năng');
      sheet.columns = LEAD_COLUMNS.map((key) => ({ header: key, key, width: 24 }));
      sheet.getRow(1).font = { bold: true };
      sheet.getRow(1).commit();
      let rows = 0;
      for await (const row of this.analytics.streamLeads(range, signal)) {
        signal?.throwIfAborted();
        if (outputError) throw outputError;
        sheet.addRow(LEAD_COLUMNS.map((key) => excelValue(key, row[key]))).commit();
        rows++;
        if (rows % 100 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
      }
      sheet.commit();
      await workbook.commit();
      await completion;
      signal?.throwIfAborted();
      return { path, rows, dispose };
    } catch (error: unknown) {
      output.destroy();
      await completion.catch(() => undefined);
      await dispose();
      throw error;
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  }
}
