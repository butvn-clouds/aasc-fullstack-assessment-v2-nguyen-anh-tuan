import { Injectable, Logger, Optional } from '@nestjs/common';
import { SyncHistoryService } from './sync-history.service';
import { ConfigService } from '@nestjs/config';
import { GoogleSheetsService, SheetRow } from '../google-sheets/google-sheets.service';
import { Bitrix24ClientService, CrmLead } from '../bitrix24/bitrix24-client.service';
import { MappingConfigService } from '../config/mapping-config.service';
import { ReverseSyncResult } from './dto/sync-result.dto';
import { buildBitrixFields, computeRowHash, normalizeContact } from './row-hash.util';
import { withSyncLock } from './sync-lock.util';
import { reverseMapping, reverseValues, crmChanged } from './conflict.util';
import { CrmPreflightService } from './crm-preflight.service';

@Injectable()
export class TwoWaySyncService {
  private readonly logger = new Logger(TwoWaySyncService.name);

  constructor(
    private readonly sheetsService: GoogleSheetsService,
    private readonly bitrixClient: Bitrix24ClientService,
    private readonly mappingConfig: MappingConfigService,
    private readonly configService: ConfigService,
    @Optional() private readonly history?: SyncHistoryService,
    @Optional() private readonly preflight?: CrmPreflightService,
  ) {}

  async run(leadId?: string): Promise<ReverseSyncResult> {
    return withSyncLock(() =>
      this.history
        ? this.history.track(leadId ? 'webhook' : 'crm_to_sheet', () => this.runUnlocked(leadId))
        : this.runUnlocked(leadId),
    );
  }

  private async runUnlocked(onlyLeadId?: string): Promise<ReverseSyncResult> {
    await this.preflight?.assertClassic();
    const result: ReverseSyncResult = {
      totalChecked: 0,
      pulledDown: 0,
      created: 0,
      updated: 0,
      conflicts: 0,
      skipped: 0,
      errors: 0,
      errorDetails: [],
      startedAt: new Date().toISOString(),
      finishedAt: '',
    };
    const config = this.mappingConfig.get();
    // Chỉ kéo trường được chọn cho các Lead ID đã liên kết trên Sheet.
    const mapping = reverseMapping(config);
    const fields = [...new Set(Object.keys(mapping).map((field) => field.split('[')[0]))];
    const { headers, rows } = await this.sheetsService.readRows();
    const ids = [
      ...new Set(
        rows
          .map((row) => row.values[config.statusColumns.leadId]?.trim())
          .filter((id) => /^[1-9]\d*$/.test(id ?? '') && (!onlyLeadId || id === onlyLeadId)),
      ),
    ];
    const leads: CrmLead[] =
      ids.length && Object.keys(mapping).length
        ? await this.bitrixClient.getLeadsByIds(ids, fields)
        : [];
    result.totalChecked = leads.length;

    const byId = new Map<string, SheetRow[]>();
    for (const row of rows) {
      const id = row.values[config.statusColumns.leadId]?.trim();
      if (id) byId.set(id, [...(byId.get(id) ?? []), row]);
    }
    const lastRow = rows.reduce((last, row) => Math.max(last, row.rowNumber), 1);
    const updates: Array<{ rowNumber: number; values: Record<string, string> }> = [];
    const strategy = this.configService.get<string>('CONFLICT_RESOLUTION_STRATEGY', 'bitrix_wins');
    if (!['bitrix_wins', 'sheet_wins'].includes(strategy))
      throw new Error('CONFLICT_RESOLUTION_STRATEGY phải là bitrix_wins hoặc sheet_wins');
    const uniqueLeads = new Map(leads.map((lead) => [String(lead.ID), lead]));
    if (uniqueLeads.size !== leads.length)
      throw new Error('CRM trả Lead ID trùng trong cùng lần đọc');
    // Một Lead có thể được nhiều dòng tham chiếu; xét xung đột riêng từng dòng.
    const targets = leads.flatMap((lead) =>
      (byId.get(String(lead.ID)) ?? []).map((row) => ({ lead, row })),
    );
    for (const target of targets) {
      const { lead } = target;
      const id = String(lead.ID);
      let row: SheetRow | undefined;
      try {
        if (!/^[1-9]\d*$/.test(id)) throw new Error('CRM trả Lead ID không hợp lệ');
        row = target.row;
        if (!row) {
          result.skipped++;
          continue;
        }
        const values = reverseValues(lead, config);
        if (!Object.keys(values).length) {
          result.skipped++;
          continue;
        }
        const local = row?.values ?? {};
        const dirty = !!row && this.sheetSideLooksDirty(row);
        const changed =
          !row ||
          crmChanged(
            lead.DATE_MODIFY,
            local[config.statusColumns.crmModifiedAt ?? config.statusColumns.lastSyncedAt],
          );
        // Vẫn điền cột vừa bổ sung dù timestamp cũ, nếu Sheet chưa có sửa đổi cục bộ.
        const missingColumn = Object.entries(values).some(
          ([column, value]) => !headers.includes(column) && (local[column] ?? '') !== value,
        );
        if (row && !changed && (dirty || !missingColumn)) {
          result.skipped++;
          continue;
        }
        if (dirty && changed) {
          result.conflicts++;
          if (strategy === 'sheet_wins') {
            result.skipped++;
            continue;
          }
        }
        const merged = { ...local, ...values };
        // Kiểm tra dữ liệu trước khi ghi và dùng cùng hash với chiều thuận.
        const hash = computeRowHash(
          buildBitrixFields(
            merged,
            config.columns,
            normalizeContact(merged, config.dedupFields),
            config.transforms,
            config.dedupFields,
            config.additionalFields,
          ),
        );
        values[config.statusColumns.leadId] = id;
        values[config.statusColumns.syncStatus] = 'Đã đồng bộ';
        values[config.statusColumns.errorMessage] = '';
        // Nếu còn trường xuôi chưa được CRM trả về, giữ baseline để không mất sửa đổi cục bộ.
        const allForwardFieldsReturned = Object.keys(config.columns).every(
          (column) => column in values,
        );
        if (!dirty || allForwardFieldsReturned) {
          values[config.statusColumns.syncHash] = hash;
        }
        values[config.statusColumns.lastSyncedAt] = config.statusColumns.crmModifiedAt
          ? result.startedAt
          : lead.DATE_MODIFY || result.startedAt;
        if (config.statusColumns.crmModifiedAt)
          values[config.statusColumns.crmModifiedAt] = lead.DATE_MODIFY || '';
        updates.push({ rowNumber: row.rowNumber, values });
        result.updated++;
      } catch (error) {
        result.errors++;
        result.errorDetails.push({
          leadId: id,
          rowNumber: row?.rowNumber,
          message: (error as Error).message,
        });
      }
    }

    if (updates.length) {
      const required = [...Object.values(mapping), ...Object.values(config.statusColumns)];
      const actualHeaders = await this.sheetsService.ensureLayout(
        headers,
        required,
        lastRow,
        config.statusColumns.leadId,
      );
      // Ghi vào vị trí xác định, không dùng append có thể tạo trùng khi mất phản hồi.
      for (let offset = 0; offset < updates.length; offset += 100) {
        await this.sheetsService.writeStatusBatch(
          actualHeaders,
          updates.slice(offset, offset + 100),
        );
      }
    }
    // Chỉ trả số thành công sau khi Google xác nhận ghi; lỗi ghi toàn request được truyền ra ngoài.
    result.pulledDown = result.created + result.updated;
    result.finishedAt = new Date().toISOString();
    this.logger.log(
      `Đồng bộ ngược: kiểm tra=${result.totalChecked}, thêm=${result.created}, cập nhật=${result.updated}, bỏ qua=${result.skipped}, lỗi=${result.errors}`,
    );
    return result;
  }

  private sheetSideLooksDirty(row: SheetRow): boolean {
    const config = this.mappingConfig.get();
    const stored = row.values[config.statusColumns.syncHash]?.trim();
    if (!stored) return false;
    try {
      return (
        stored !==
        computeRowHash(
          buildBitrixFields(
            row.values,
            config.columns,
            normalizeContact(row.values, config.dedupFields),
            config.transforms,
            config.dedupFields,
            config.additionalFields,
          ),
        )
      );
    } catch {
      return true;
    }
  }
}
