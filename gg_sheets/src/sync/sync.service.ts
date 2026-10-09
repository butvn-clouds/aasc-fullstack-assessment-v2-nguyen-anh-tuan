import { Injectable, Logger, Optional } from '@nestjs/common';
import { SyncHistoryService } from './sync-history.service';
import { ConfigService } from '@nestjs/config';
import { GoogleSheetsService, SheetRow } from '../google-sheets/google-sheets.service';
import { Bitrix24ClientService, CrmLead } from '../bitrix24/bitrix24-client.service';
import { MappingConfigService, StatusColumns } from '../config/mapping-config.service';
import { mapWithConcurrency } from '../common/concurrency.util';
import { buildBitrixFields, computeRowHash, normalizeContact } from './row-hash.util';
import { SyncResult } from './dto/sync-result.dto';
import { withSyncLock } from './sync-lock.util';
import { reverseMapping, reverseValues, crmChanged } from './conflict.util';
import { CrmPreflightService } from './crm-preflight.service';
import { CreateJournalService } from './create-journal.service';
import { publicError } from '../common/public-error';

const MAX_COMMANDS_PER_BATCH = 50; // Giới hạn số lệnh batch của Bitrix24.

type RowPlan =
  | { action: 'pull'; rowNumber: number; values: Record<string, string> }
  | { action: 'skip'; rowNumber: number }
  | { action: 'error'; rowNumber: number; message: string }
  | {
      action: 'create' | 'update';
      rowNumber: number;
      fields: Record<string, unknown>;
      hash: string;
      existingLeadId?: string;
      crmModifiedAt?: string;
    };
type PendingPlan = Extract<RowPlan, { action: 'create' | 'update' }>;

/** Mã lỗi do batchWrite tự sinh khi mất phản hồi CRM: kết quả ghi CHƯA XÁC ĐỊNH, không phải bị từ chối. */
const UNCERTAIN_ERROR_CODES = new Set(['MISSING_RESULT', 'UNCERTAIN_WRITE']);

/** Điều phối Sheet → Lead: lập kế hoạch từ snapshot, ghi CRM theo batch rồi lưu kết quả về Sheet. */
@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly sheetsService: GoogleSheetsService,
    private readonly bitrixClient: Bitrix24ClientService,
    private readonly mappingConfig: MappingConfigService,
    private readonly configService: ConfigService,
    @Optional() private readonly history?: SyncHistoryService,
    @Optional() private readonly preflight?: CrmPreflightService,
    @Optional() private readonly journal?: CreateJournalService,
  ) {}

  async run(): Promise<SyncResult> {
    return withSyncLock(() =>
      this.history
        ? this.history.track('sheet_to_crm', () => this.runUnlocked())
        : this.runUnlocked(),
    );
  }

  private async runUnlocked(): Promise<SyncResult> {
    await this.preflight?.assertClassic();
    const startedAt = new Date().toISOString();
    const result: SyncResult = {
      totalRows: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      errorDetails: [],
      startedAt,
      finishedAt: '',
      conflicts: 0,
      pulledDown: 0,
    };

    const { headers, rows } = await this.sheetsService.readRows();
    result.totalRows = rows.length;
    this.logger.log(`Bắt đầu đồng bộ: đã đọc ${rows.length} dòng từ Sheet`);

    const mapping = this.mappingConfig.get();
    // Chuẩn bị và kiểm tra quyền ghi Sheet trước mọi thao tác ghi CRM.
    const actualHeaders = await this.sheetsService.ensureLayout(
      headers,
      [...Object.values(mapping.statusColumns), ...Object.values(reverseMapping(mapping))],
      rows.reduce((last, row) => Math.max(last, row.rowNumber), 1),
      mapping.statusColumns.leadId,
    );
    const linkedIds = rows.map((row) => row.values[mapping.statusColumns.leadId]?.trim());

    // Một lượt đọc theo nhóm tối đa 50 ID ở client, tránh N lời gọi cho N dòng.
    const remoteById = new Map<string, CrmLead>();
    if (this.configService.get('SYNC_DIRECTION', 'forward') === 'both') {
      const ids = [...new Set(linkedIds.filter((id) => /^[1-9]\d*$/.test(id ?? '')))];
      const remote = await this.bitrixClient.getLeadsByIds(
        ids,
        Object.keys(reverseMapping(mapping)).map((field) => field.split('[')[0]),
      );
      for (const lead of remote) remoteById.set(String(lead.ID), lead);
    }

    const concurrency = Number(this.configService.get('SYNC_BITRIX_CONCURRENCY', 2));
    const plans = await mapWithConcurrency(rows, concurrency, (row) =>
      this.planRow(row, remoteById),
    );

    const pending = plans.filter(
      (plan): plan is PendingPlan => plan.action === 'create' || plan.action === 'update',
    );

    // Đọc lại snapshot NGAY TRƯỚC mọi thao tác ghi (kể cả ghi "Chờ xử lý"): số dòng của Google Sheets
    // là vị trí, nên sort/chèn/xóa giữa lúc đọc và ghi có thể gắn Lead ID vào sai khách hàng.
    // Fail-closed: dừng và để lần chạy sau lập kế hoạch lại từ snapshot mới. Đặt trước khi ghi
    // "Chờ xử lý" để không để lại dòng "Chờ xử lý" mồ côi khi bị hủy.
    if (pending.length) await this.assertPendingRowsUnchanged(pending);

    if (pending.length)
      await this.sheetsService.writeStatusBatch(
        actualHeaders,
        pending.map((plan) => ({
          rowNumber: plan.rowNumber,
          values: {
            [mapping.statusColumns.syncStatus]: 'Chờ xử lý',
            [mapping.statusColumns.errorMessage]: '',
          },
        })),
      );

    const statusUpdates = await this.executePlans(plans, result);

    await this.sheetsService.writeStatusBatch(actualHeaders, statusUpdates);
    this.journal?.acknowledge(
      statusUpdates
        .filter((update) => update.values[mapping.statusColumns.leadId])
        .map((update) => update.rowNumber),
    );

    for (const detail of result.errorDetails)
      this.logger.error(`Dòng ${detail.rowNumber}: ${detail.message}`);

    result.finishedAt = new Date().toISOString();
    this.logger.log(
      `Đồng bộ hoàn tất: tạo mới=${result.created} cập nhật=${result.updated} bỏ qua=${result.skipped} lỗi=${result.errors}`,
    );
    return result;
  }

  private async assertPendingRowsUnchanged(pending: PendingPlan[]): Promise<void> {
    const fresh = await this.sheetsService.readRows();
    const byRow = new Map(fresh.rows.map((row) => [row.rowNumber, row]));
    const config = this.mappingConfig.get();
    for (const plan of pending) {
      const row = byRow.get(plan.rowNumber);
      if (!row)
        throw new Error(`SHEET_CHANGED_DURING_SYNC: dòng ${plan.rowNumber} đã bị di chuyển/xóa`);
      const normalized = normalizeContact(row.values, config.dedupFields);
      const fields = buildBitrixFields(
        row.values,
        config.columns,
        normalized,
        config.transforms,
        config.dedupFields,
        config.additionalFields,
      );
      if (computeRowHash(fields) !== plan.hash)
        throw new Error(`SHEET_CHANGED_DURING_SYNC: dữ liệu dòng ${plan.rowNumber} đã thay đổi`);
    }
  }

  /** Giai đoạn 1: quyết định xử lý một dòng, chưa thực hiện thao tác ghi. */
  private async planRow(row: SheetRow, remoteById: Map<string, CrmLead>): Promise<RowPlan> {
    const { columns, statusColumns } = this.mappingConfig.get();

    try {
      const { dedupFields, transforms } = this.mappingConfig.get();
      const { email, phone } = normalizeContact(row.values, dedupFields);
      const fields = buildBitrixFields(
        row.values,
        columns,
        { email, phone },
        transforms,
        dedupFields,
        this.mappingConfig.get().additionalFields,
      );
      const hash = computeRowHash(fields);

      const linkedId = row.values[statusColumns.leadId]?.trim();
      if (linkedId && !/^[1-9]\d*$/.test(linkedId)) throw new Error('Lead ID không hợp lệ');
      const recovery = this.journal?.lookup(row.rowNumber, hash, linkedId);
      const existingLeadId = linkedId || recovery?.leadId;
      const storedHash = row.values[statusColumns.syncHash]?.trim();

      if (existingLeadId) {
        if (!/^[1-9]\d*$/.test(existingLeadId)) throw new Error('Lead ID không hợp lệ');
        if (storedHash === hash && !recovery) {
          return { action: 'skip', rowNumber: row.rowNumber };
        }
        // MVP một chiều: Sheet là nguồn dữ liệu; chỉ xử lý xung đột khi bật both.
        if (this.configService.get('SYNC_DIRECTION', 'forward') !== 'both') {
          return { action: 'update', rowNumber: row.rowNumber, fields, hash, existingLeadId };
        }
        const config = this.mappingConfig.get();
        const strategy = this.configService.get<string>(
          'CONFLICT_RESOLUTION_STRATEGY',
          'bitrix_wins',
        );
        if (!['bitrix_wins', 'sheet_wins'].includes(strategy))
          throw new Error('Chiến lược xung đột không hợp lệ');
        // ID phục hồi chưa có trên snapshot Sheet nên đọc bổ sung trường hợp đó.
        const remote =
          remoteById.get(existingLeadId) ??
          (recovery
            ? (
                await this.bitrixClient.getLeadsByIds(
                  [existingLeadId],
                  Object.keys(reverseMapping(config)).map((field) => field.split('[')[0]),
                )
              )[0]
            : undefined);
        if (!remote) throw new Error('Không tìm thấy Lead đã liên kết; kiểm tra ID và quyền CRM');
        const baseline = statusColumns.crmModifiedAt
          ? row.values[statusColumns.crmModifiedAt]
          : row.values[statusColumns.lastSyncedAt];
        if (crmChanged(remote.DATE_MODIFY, baseline) && strategy === 'bitrix_wins') {
          const pulled = reverseValues(remote, config);
          if (!Object.keys(pulled).length)
            throw new Error(
              'CRM đã thay đổi nhưng chưa cấu hình trường kéo về; kiểm tra reverseColumns',
            );
          const merged = { ...row.values, ...pulled };
          buildBitrixFields(
            merged,
            columns,
            normalizeContact(merged, config.dedupFields),
            config.transforms,
            config.dedupFields,
            config.additionalFields,
          );
          return {
            action: 'pull',
            rowNumber: row.rowNumber,
            values: {
              ...pulled,
              [statusColumns.lastSyncedAt]: new Date().toISOString(),
              ...(statusColumns.crmModifiedAt
                ? { [statusColumns.crmModifiedAt]: remote.DATE_MODIFY || '' }
                : { [statusColumns.lastSyncedAt]: remote.DATE_MODIFY || '' }),
              [statusColumns.syncStatus]: 'Ưu tiên CRM; đã kéo về Sheet',
              [statusColumns.errorMessage]: '',
            },
          };
        }
        return {
          action: 'update',
          rowNumber: row.rowNumber,
          fields,
          hash,
          existingLeadId,
          crmModifiedAt: remote.DATE_MODIFY,
        };
      }

      let duplicate: { ID: string } | null = null;
      const emails =
        (fields.EMAIL as Array<{ VALUE: string }> | undefined)?.map((v) => v.VALUE) ?? [];
      const phones =
        (fields.PHONE as Array<{ VALUE: string }> | undefined)?.map((v) => v.VALUE) ?? [];
      for (let i = 0; i < Math.max(emails.length, phones.length, 1); i++) {
        const found = await this.bitrixClient.findLeadByEmailOrPhone(emails[i], phones[i]);
        if (found && duplicate && String(found.ID) !== String(duplicate.ID))
          throw new Error('Thông tin liên hệ trùng với các lead CRM khác nhau; cần xử lý thủ công');
        if (found) duplicate = found;
      }
      if (duplicate) {
        return {
          action: 'update',
          rowNumber: row.rowNumber,
          fields,
          hash,
          existingLeadId: duplicate.ID,
        };
      }

      if (recovery) throw new Error('RECOVERY_UNCERTAIN');

      return { action: 'create', rowNumber: row.rowNumber, fields, hash };
    } catch (error) {
      if ((error as Error).message === 'RECOVERY_STORAGE_ERROR') throw error;
      if ((error as Error).message.startsWith('RECOVERY_')) {
        const detail = publicError(error);
        return {
          action: 'error',
          rowNumber: row.rowNumber,
          message: `[${detail.code}] ${detail.message}`,
        };
      }
      return { action: 'error', rowNumber: row.rowNumber, message: (error as Error).message };
    }
  }

  /** Giai đoạn 2: thực thi theo lô, tối đa 50 lệnh mỗi lần gọi Bitrix24. */
  private async executePlans(
    plans: RowPlan[],
    result: SyncResult,
  ): Promise<Array<{ rowNumber: number; values: Record<string, string> }>> {
    const { statusColumns } = this.mappingConfig.get();
    const statusUpdates: Array<{ rowNumber: number; values: Record<string, string> }> = [];

    for (const plan of plans) {
      if (plan.action === 'pull') {
        result.conflicts = (result.conflicts ?? 0) + 1;
        result.pulledDown = (result.pulledDown ?? 0) + 1;
        statusUpdates.push({ rowNumber: plan.rowNumber, values: plan.values });
      } else if (plan.action === 'skip') {
        result.skipped++;
      } else if (plan.action === 'error') {
        result.errors++;
        result.errorDetails.push({ rowNumber: plan.rowNumber, message: plan.message });
        statusUpdates.push({
          rowNumber: plan.rowNumber,
          values: { [statusColumns.syncStatus]: 'Lỗi', [statusColumns.errorMessage]: plan.message },
        });
      }
    }

    const writablePlans = plans
      .filter(
        (p): p is Extract<RowPlan, { action: 'create' | 'update' }> =>
          p.action === 'create' || p.action === 'update',
      )
      .sort((a, b) => a.rowNumber - b.rowNumber);

    const known = new Map<string, string>();
    const uncertain = new Set<string>();
    const keys = (plan: (typeof writablePlans)[number]): string[] =>
      ['EMAIL', 'PHONE'].flatMap((type) =>
        ((plan.fields[type] as Array<{ VALUE: string }>) ?? []).map((v) => `${type}:${v.VALUE}`),
      );
    for (const plan of writablePlans)
      if (plan.existingLeadId) for (const key of keys(plan)) known.set(key, plan.existingLeadId);
    for (let i = 0; i < writablePlans.length;) {
      const used = new Set<string>();
      const usedIds = new Set<string>();
      const chunk: typeof writablePlans = [];
      while (i < writablePlans.length && chunk.length < MAX_COMMANDS_PER_BATCH) {
        const plan = writablePlans[i];
        const contacts = keys(plan);
        const targetId = plan.existingLeadId ?? contacts.map((key) => known.get(key)).find(Boolean);
        if (chunk.length && targetId && usedIds.has(targetId)) break;
        if (chunk.length && contacts.some((key) => used.has(key))) break;
        i++;
        contacts.forEach((key) => used.add(key));
        const ids = new Set(contacts.map((key) => known.get(key)).filter(Boolean));
        if (ids.size > 1 || contacts.some((key) => uncertain.has(key))) {
          const message =
            'Không xác định được lead liên quan hoặc lần ghi trước thất bại; kiểm tra trước khi thử lại';
          result.errors++;
          result.errorDetails.push({ rowNumber: plan.rowNumber, message });
          statusUpdates.push({
            rowNumber: plan.rowNumber,
            values: { [statusColumns.syncStatus]: 'Lỗi', [statusColumns.errorMessage]: message },
          });
          continue;
        }
        if (plan.action === 'create' && ids.size) {
          plan.action = 'update';
          plan.existingLeadId = [...ids][0];
        }
        chunk.push(plan);
        if (plan.existingLeadId) usedIds.add(plan.existingLeadId);
      }
      if (!chunk.length) continue;
      this.journal?.begin(chunk.filter((plan) => plan.action === 'create'));
      const commands: Record<string, string> = {};
      chunk.forEach((plan, idx) => {
        const cmdKey = `cmd${idx}`;
        commands[cmdKey] =
          plan.action === 'create'
            ? this.bitrixClient.buildCommand('crm.lead.add', { fields: plan.fields })
            : this.bitrixClient.buildCommand('crm.lead.update', {
                id: plan.existingLeadId,
                fields: plan.fields,
              });
      });

      let batchResult: Record<string, unknown>;
      let batchErrors: Record<string, unknown> | undefined;
      try {
        const response = await this.bitrixClient.batchWrite(commands);
        batchResult = response.result;
        batchErrors = response.result_error;
      } catch (error) {
        for (const plan of chunk) {
          keys(plan).forEach((key) => uncertain.add(key));
          const message = (error as Error).message;
          result.errors++;
          result.errorDetails.push({ rowNumber: plan.rowNumber, message });
          statusUpdates.push({
            rowNumber: plan.rowNumber,
            values: { [statusColumns.syncStatus]: 'Lỗi', [statusColumns.errorMessage]: message },
          });
        }
        continue;
      }

      chunk.forEach((plan, idx) => {
        const cmdKey = `cmd${idx}`;
        const cmdError =
          batchErrors?.[cmdKey] ??
          (batchResult?.[cmdKey] === undefined ||
          batchResult[cmdKey] === false ||
          (plan.action === 'create' && !/^[1-9]\d*$/.test(String(batchResult?.[cmdKey])))
            ? 'Thiếu kết quả xử lý theo lô hoặc xử lý không thành công'
            : undefined);

        if (cmdError) {
          const errorCode = (batchErrors?.[cmdKey] as { error?: string } | undefined)?.error;
          // Giữ journal nếu chưa rõ CRM đã ghi hay chưa, kể cả Lead không có email/điện thoại.
          const explicitError = errorCode !== undefined && !UNCERTAIN_ERROR_CODES.has(errorCode);
          if (plan.action === 'create' && explicitError) {
            // CRM xác nhận từ chối: cho phép sửa dữ liệu rồi thử lại.
            this.journal?.acknowledge([plan.rowNumber]);
          } else {
            keys(plan).forEach((key) => uncertain.add(key));
          }
          result.errors++;
          const message = this.formatBatchError(cmdError);
          result.errorDetails.push({ rowNumber: plan.rowNumber, message });
          statusUpdates.push({
            rowNumber: plan.rowNumber,
            values: { [statusColumns.syncStatus]: 'Lỗi', [statusColumns.errorMessage]: message },
          });
          return;
        }

        const leadId =
          plan.action === 'create' ? String(batchResult[cmdKey]) : plan.existingLeadId!;
        if (plan.action === 'create') this.journal?.confirm(plan.rowNumber, leadId);
        keys(plan).forEach((key) => known.set(key, leadId));
        result[plan.action === 'create' ? 'created' : 'updated']++;
        statusUpdates.push({
          rowNumber: plan.rowNumber,
          values: this.statusValues(statusColumns, leadId, plan.hash, plan.crmModifiedAt),
        });
      });
    }

    return statusUpdates;
  }

  private formatBatchError(error: unknown): string {
    if (error && typeof error === 'object') {
      const e = error as { error?: string; error_description?: string };
      return `[${e.error ?? 'UNKNOWN'}] ${e.error_description ?? ''}`.trim();
    }
    return String(error);
  }

  private statusValues(
    statusColumns: StatusColumns,
    leadId: string,
    hash: string,
    crmModifiedAt?: string,
  ): Record<string, string> {
    return {
      [statusColumns.leadId]: leadId,
      [statusColumns.syncStatus]: 'Đã đồng bộ',
      [statusColumns.lastSyncedAt]: new Date().toISOString(),
      [statusColumns.errorMessage]: '',
      [statusColumns.syncHash]: hash,
      // Giữ mốc đã đọc trước khi ghi; lần reverse sau kiểm tra lại, không nhận nhầm sửa đổi ngoài ứng dụng là đã đồng bộ.
      ...(statusColumns.crmModifiedAt
        ? { [statusColumns.crmModifiedAt]: crmModifiedAt ?? '' }
        : {}),
    };
  }
}
