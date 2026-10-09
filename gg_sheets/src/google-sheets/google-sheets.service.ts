import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, sheets_v4 } from 'googleapis';
import * as fs from 'fs';
import { AppConfig } from '../config/configuration';
import { RateLimiter } from '../common/rate-limiter.util';
import { retryWithBackoff } from '../common/retry.util';
import { SheetRow } from '../common/types';
export type { SheetRow } from '../common/types';

@Injectable()
export class GoogleSheetsService implements OnModuleInit {
  private readonly logger = new Logger(GoogleSheetsService.name);
  private sheetsClient!: sheets_v4.Sheets;
  // Google Sheets API: quota mac dinh 60 read + 60 write requests / phut / user.
  private readonly rateLimiter = new RateLimiter(55, 60_000);

  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

  async onModuleInit(): Promise<void> {
    this.sheetsClient = await this.buildClient();
  }

  /** Chỉ đọc ô tiêu đề, không trả dữ liệu khách hàng hoặc thử ghi. */
  async checkConnection(): Promise<void> {
    const { sheetId, worksheetName } = this.configService.get('google', { infer: true });
    await this.sheetsClient.spreadsheets.values.get(
      {
        spreadsheetId: sheetId,
        range: `'${worksheetName.replace(/'/g, "''")}'!A1`,
      },
      { timeout: 15000 },
    );
  }

  private async buildClient(): Promise<sheets_v4.Sheets> {
    const googleConfig = this.configService.get('google', { infer: true });

    if (['oauth', 'oauth2'].includes(googleConfig.authMode)) {
      const oauth2Client = new google.auth.OAuth2(
        googleConfig.oauthClientId,
        googleConfig.oauthClientSecret,
      );
      oauth2Client.setCredentials({ refresh_token: googleConfig.oauthRefreshToken });
      return google.sheets({ version: 'v4', auth: oauth2Client, timeout: 30000 });
    }

    let credentials: Record<string, any> | undefined;
    if (googleConfig.serviceAccountKeyJson) {
      credentials = JSON.parse(googleConfig.serviceAccountKeyJson);
    } else if (
      googleConfig.serviceAccountKeyPath &&
      fs.existsSync(googleConfig.serviceAccountKeyPath)
    ) {
      credentials = JSON.parse(fs.readFileSync(googleConfig.serviceAccountKeyPath, 'utf-8'));
    } else {
      throw new Error(
        'Thiếu cấu hình tài khoản dịch vụ Google. Cần GOOGLE_SERVICE_ACCOUNT_KEY_JSON hoặc GOOGLE_SERVICE_ACCOUNT_KEY_PATH.',
      );
    }

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const authClient = (await auth.getClient()) as any;
    return google.sheets({ version: 'v4', auth: authClient, timeout: 30000 });
  }

  async readRows(): Promise<{ headers: string[]; rows: SheetRow[] }> {
    const { sheetId, worksheetName, detectFormats } = this.configService.get('google', {
      infer: true,
    });

    const response = await this.withRetry(() =>
      this.sheetsClient.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: `'${worksheetName.replace(/'/g, "''")}'`,
        valueRenderOption: 'UNFORMATTED_VALUE',
        dateTimeRenderOption: detectFormats ? 'SERIAL_NUMBER' : 'FORMATTED_STRING',
      }),
    );

    const allValues = response.data.values ?? [];
    if (detectFormats && allValues.length > 1) {
      const width = Math.max(...allValues.map((row) => row.length), 1);
      const metadata = await this.withRetry(() =>
        this.sheetsClient.spreadsheets.get({
          spreadsheetId: sheetId,
          ranges: [
            `'${worksheetName.replace(/'/g, "''")}'!A1:${columnIndexToLetter(width - 1)}${allValues.length}`,
          ],
          fields:
            'sheets.data(startRow,startColumn,rowData.values.effectiveFormat.numberFormat.type)',
        }),
      );
      for (const sheet of metadata.data.sheets ?? [])
        for (const block of sheet.data ?? []) {
          (block.rowData ?? []).forEach((row, rowIndex) =>
            (row.values ?? []).forEach((cell, columnIndex) => {
              const r = (block.startRow ?? 0) + rowIndex,
                c = (block.startColumn ?? 0) + columnIndex;
              const value = allValues[r]?.[c];
              if (
                r > 0 &&
                typeof value === 'number' &&
                ['DATE', 'DATE_TIME'].includes(cell.effectiveFormat?.numberFormat?.type ?? '')
              ) {
                const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
                if (!Number.isFinite(date.getTime()))
                  throw new Error(`Ngày không hợp lệ tại dòng ${r + 1}`);
                allValues[r][c] = date.toISOString().slice(0, 10);
              }
            }),
          );
        }
    }
    if (allValues.length === 0) {
      return { headers: [], rows: [] };
    }

    const headers = (allValues[0] as string[]).map((h) => (h ?? '').toString().trim());
    const namedHeaders = headers.filter(Boolean);
    if (new Set(namedHeaders).size !== namedHeaders.length)
      throw new Error('Sheet có tiêu đề cột trùng');
    const rows: SheetRow[] = [];

    for (let i = 1; i < allValues.length; i++) {
      const rawRow = allValues[i] as any[];
      const values: Record<string, string> = {};
      headers.forEach((header, colIndex) => {
        if (!header) return;
        values[header] =
          rawRow[colIndex] !== undefined && rawRow[colIndex] !== null
            ? String(rawRow[colIndex])
            : '';
      });
      const hasAnyValue = Object.values(values).some((v) => v.trim().length > 0);
      if (!hasAnyValue) continue;

      rows.push({ rowNumber: i + 1, values }); // +1 vi Sheets 1-based, i=0 la header
    }

    return { headers, rows };
  }

  async writeStatusBatch(
    headers: string[],
    updates: Array<{ rowNumber: number; values: Record<string, string> }>,
  ): Promise<void> {
    const { sheetId, worksheetName } = this.configService.get('google', { infer: true });
    const data = updates.flatMap((update) =>
      Object.entries(update.values).map(([column, value]) => {
        const index = headers.indexOf(column);
        if (index < 0) throw new Error(`Không tìm thấy cột "${column}" trên Sheet`);
        return {
          range: `'${worksheetName.replace(/'/g, "''")}'!${columnIndexToLetter(index)}${update.rowNumber}`,
          values: [[value]],
        };
      }),
    );
    if (!data.length) return;
    // Giới hạn kích thước mỗi lượt ghi; retry chỉ lô đang lỗi, các range RAW có vị trí cố định.
    for (let offset = 0; offset < data.length; offset += 500) {
      await this.withRetry(() =>
        this.sheetsClient.spreadsheets.values.batchUpdate({
          spreadsheetId: sheetId,
          requestBody: { valueInputOption: 'RAW', data: data.slice(offset, offset + 500) },
        }),
      );
    }
  }

  /** Thêm cột ở cuối và mở rộng lưới trước khi nhập lead mới, không đổi vị trí dữ liệu. */
  async ensureLayout(
    headers: string[],
    required: string[],
    lastRow: number,
    hiddenColumn?: string,
  ): Promise<string[]> {
    const nonEmpty = headers.filter(Boolean);
    if (new Set(nonEmpty).size !== nonEmpty.length) throw new Error('Sheet có tiêu đề cột trùng');
    const missing = [...new Set(required)].filter((column) => !headers.includes(column));
    const next = [...headers, ...missing];
    const { sheetId, worksheetName } = this.configService.get('google', { infer: true });
    const response = await this.withRetry(() =>
      this.sheetsClient.spreadsheets.get({ spreadsheetId: sheetId, fields: 'sheets.properties' }),
    );
    const properties = response.data.sheets?.find(
      (sheet) => sheet.properties?.title === worksheetName,
    )?.properties;
    if (!properties) throw new Error('Không tìm thấy tab Sheet đã cấu hình');
    const grid = properties.gridProperties ?? {};
    const rowCount = Math.max(lastRow, grid.rowCount ?? 1);
    const columnCount = Math.max(next.length, grid.columnCount ?? 1);
    if (rowCount !== grid.rowCount || columnCount !== grid.columnCount) {
      await this.withRetry(() =>
        this.sheetsClient.spreadsheets.batchUpdate({
          spreadsheetId: sheetId,
          requestBody: {
            requests: [
              {
                updateSheetProperties: {
                  properties: {
                    sheetId: properties.sheetId,
                    gridProperties: { rowCount, columnCount },
                  },
                  fields: 'gridProperties.rowCount,gridProperties.columnCount',
                },
              },
            ],
          },
        }),
      );
    }
    if (missing.length)
      await this.writeStatusBatch(next, [
        { rowNumber: 1, values: Object.fromEntries(missing.map((column) => [column, column])) },
      ]);
    if (hiddenColumn && next.includes(hiddenColumn)) {
      const index = next.indexOf(hiddenColumn);
      await this.withRetry(() =>
        this.sheetsClient.spreadsheets.batchUpdate({
          spreadsheetId: sheetId,
          requestBody: {
            requests: [
              {
                updateDimensionProperties: {
                  range: {
                    sheetId: properties.sheetId,
                    dimension: 'COLUMNS',
                    startIndex: index,
                    endIndex: index + 1,
                  },
                  properties: { hiddenByUser: true },
                  fields: 'hiddenByUser',
                },
              },
            ],
          },
        }),
      );
    }
    return next;
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    const { maxRetries, retryBaseDelayMs } = this.configService.get('sync', { infer: true });
    return retryWithBackoff(
      async () => {
        await this.rateLimiter.acquire();
        return fn();
      },
      {
        maxRetries,
        baseDelayMs: retryBaseDelayMs,
        onRetry: (attempt, error, delayMs) => {
          this.logger.warn(
            `Google Sheets API gặp lỗi (lần thử ${attempt}), sẽ thử lại sau ${Math.round(delayMs)} ms: ${
              error?.message ?? error
            }`,
          );
        },
      },
    );
  }
}

/** Chuyen index cot (0-based) sang chu cai cot kieu Excel/Sheets (0 -> A, 25 -> Z, 26 -> AA...) */
export function columnIndexToLetter(index: number): string {
  let letter = '';
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}
