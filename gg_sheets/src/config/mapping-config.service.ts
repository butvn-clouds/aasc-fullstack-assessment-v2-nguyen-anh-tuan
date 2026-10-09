import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFileSync, writeFileSync, renameSync } from 'fs';
import { join } from 'path';

export interface StatusColumns {
  leadId: string;
  syncStatus: string;
  lastSyncedAt: string;
  crmModifiedAt?: string;
  errorMessage: string;
  syncHash: string;
}

export interface MappingConfig {
  columns: Record<string, string>; // Tiêu đề cột Sheet -> trường Bitrix24
  additionalFields?: Record<string, string>; // Trường CRM bổ sung -> cột nguồn (một cột ra nhiều trường).
  statusColumns: StatusColumns;
  dedupFields: string[]; // Các khóa trong columns dùng để kiểm tra trùng (email/điện thoại)
  /** Ánh xạ ngược Bitrix24 -> Sheet: tên trường CRM -> tiêu đề cột cần ghi.
   * Chỉ kéo về các trường được liệt kê; columns vẫn là cấu hình cho chiều đồng bộ xuôi. */
  reverseColumns?: Record<string, string>;
  transforms?: Record<string, FieldTransform>;
}

export interface FieldTransform {
  type: 'enum' | 'multi_value' | 'date' | 'string' | 'number' | 'enum_normalized';
  values?: Record<string, string>;
  separator?: string;
  valueType?: string;
  required?: boolean;
}

/** Nạp mapping khi khởi động; kiểm tra và lưu nguyên tử các thay đổi từ Admin. */
@Injectable()
export class MappingConfigService implements OnModuleInit {
  private readonly logger = new Logger(MappingConfigService.name);
  private config!: MappingConfig;
  private path!: string;

  onModuleInit(): void {
    this.path =
      process.env.MAPPING_CONFIG_PATH ??
      process.env.MAPPING_FILE_PATH ??
      join(process.cwd(), 'config', 'mapping.json');
    this.config = this.parseAndValidate(readFileSync(this.path, 'utf-8'));
    this.logger.log(`Đã nạp cấu hình ánh xạ từ ${this.path}`);
  }

  get(): MappingConfig {
    return this.config;
  }

  update(next: MappingConfig): MappingConfig {
    let validated: MappingConfig;
    try {
      validated = this.parseAndValidate(JSON.stringify(next));
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(validated, null, 2)}\n`, 'utf-8');
    renameSync(temporary, this.path);
    this.config = validated;
    return this.config;
  }

  private parseAndValidate(raw: string): MappingConfig {
    let parsed = JSON.parse(raw) as MappingConfig;
    // Đọc định dạng fields cũ nhưng chỉ dùng một mô hình nội bộ; không tự ghi lại file.
    const legacy = parsed as unknown as {
      fields?: Array<{
        sheetColumn: string;
        bitrixField: string;
        type?: string;
        required?: boolean;
        multiValue?: boolean;
        valueType?: string;
        values?: Record<string, string>;
        separator?: string;
      }>;
      dedupeColumns?: Record<string, string>;
      statusColumns: StatusColumns;
    };
    if (Array.isArray(legacy?.fields) && !parsed.columns) {
      parsed = {
        columns: {},
        additionalFields: {},
        statusColumns: legacy.statusColumns,
        dedupFields: Object.values(legacy.dedupeColumns ?? {}),
        transforms: {},
        reverseColumns: parsed.reverseColumns,
      };
      for (const rule of legacy.fields) {
        if (!rule.sheetColumn || !rule.bitrixField)
          throw new Error('Mỗi fields cần có sheetColumn và bitrixField');
        const field = rule.multiValue ? `${rule.bitrixField}[0][VALUE]` : rule.bitrixField;
        if (parsed.columns[rule.sheetColumn]) parsed.additionalFields![field] = rule.sheetColumn;
        else parsed.columns[rule.sheetColumn] = field;
        parsed.transforms![rule.sheetColumn] = {
          type: rule.multiValue
            ? 'multi_value'
            : rule.type === 'number' || rule.type === 'date'
              ? rule.type
              : rule.type === 'enum'
                ? rule.values
                  ? 'enum'
                  : 'enum_normalized'
                : 'string',
          required: rule.required,
          valueType: rule.valueType,
          values: rule.values,
          separator: rule.separator,
        };
      }
    }
    if (!parsed || !parsed.columns || !parsed.statusColumns || !Array.isArray(parsed.dedupFields)) {
      throw new Error('mapping.json cần có columns, statusColumns và dedupFields');
    }
    const validRecord = (value: unknown): value is Record<string, string> =>
      !!value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.entries(value).every(
        ([key, val]) => key.trim() && typeof val === 'string' && val.trim(),
      );
    if (
      !validRecord(parsed.columns) ||
      !Object.keys(parsed.columns).length ||
      !validRecord(parsed.statusColumns)
    )
      throw new Error('columns và statusColumns phải là các mục ánh xạ dạng văn bản, không được để trống');
    for (const key of ['leadId', 'syncStatus', 'lastSyncedAt', 'errorMessage', 'syncHash'])
      if (!(parsed.statusColumns as unknown as Record<string, string>)[key])
        throw new Error(`Thiếu statusColumns.${key}`);
    if (parsed.reverseColumns !== undefined && !validRecord(parsed.reverseColumns))
      throw new Error('reverseColumns không hợp lệ');
    const statusNames = Object.values(parsed.statusColumns);
    if (new Set(statusNames).size !== statusNames.length)
      throw new Error('Các cột trạng thái phải có tên riêng biệt');
    if (Object.keys(parsed.columns).some((column) => statusNames.includes(column)))
      throw new Error('Không ánh xạ cột trạng thái hệ thống vào dữ liệu CRM');
    const targets = Object.values(parsed.reverseColumns ?? {});
    if (new Set(targets).size !== targets.length)
      throw new Error('Mỗi cột Sheet chỉ nhận một trường CRM ở chiều ngược');
    if (
      [
        ...Object.values(parsed.columns),
        ...Object.keys(parsed.additionalFields ?? {}),
        ...Object.keys(parsed.reverseColumns ?? {}),
      ].some((field) => !/^[A-Z][A-Z0-9_]*(?:\[0\]\[VALUE\])?$/.test(field))
    )
      throw new Error('Mã trường CRM không hợp lệ');
    if (targets.some((column) => Object.values(parsed.statusColumns).includes(column)))
      throw new Error('Không ánh xạ dữ liệu CRM vào cột trạng thái hệ thống');
    if (
      parsed.additionalFields !== undefined &&
      (!validRecord(parsed.additionalFields) ||
        Object.values(parsed.additionalFields).some((column) => !parsed.columns[column]))
    )
      throw new Error('additionalFields phải tham chiếu đến cột đã được ánh xạ');
    const forwardTargets = [
      ...Object.values(parsed.columns),
      ...Object.keys(parsed.additionalFields ?? {}),
    ];
    if (new Set(forwardTargets).size !== forwardTargets.length)
      throw new Error('Mỗi trường CRM chỉ nhận dữ liệu từ một cột Sheet');
    if (
      parsed.transforms !== undefined &&
      (!parsed.transforms ||
        typeof parsed.transforms !== 'object' ||
        Array.isArray(parsed.transforms))
    )
      throw new Error('transforms phải là đối tượng cấu hình');
    if (parsed.dedupFields.some((column) => typeof column !== 'string' || !parsed.columns[column]))
      throw new Error('dedupFields phải tham chiếu các cột đã ánh xạ');
    for (const [column, transform] of Object.entries(parsed.transforms ?? {})) {
      if (!parsed.columns[column])
        throw new Error(`Phép chuyển đổi tham chiếu cột chưa được ánh xạ "${column}"`);
      if (
        !transform ||
        !['enum', 'multi_value', 'date', 'string', 'number', 'enum_normalized'].includes(
          transform.type,
        )
      ) {
        throw new Error(`Không hỗ trợ kiểu chuyển đổi cho "${column}"`);
      }
      if (
        transform.type === 'enum' &&
        (!validRecord(transform.values) || !Object.keys(transform.values).length)
      ) {
        throw new Error(`Phép chuyển đổi danh sách giá trị "${column}" phải khai báo values`);
      }
      if (
        transform.separator !== undefined &&
        (typeof transform.separator !== 'string' || !transform.separator.length)
      )
        throw new Error('separator phải là chuỗi và không được để trống');
      if (transform.required !== undefined && typeof transform.required !== 'boolean')
        throw new Error('required phải có giá trị đúng hoặc sai');
      if (
        transform.valueType !== undefined &&
        (typeof transform.valueType !== 'string' || !transform.valueType.trim())
      )
        throw new Error('valueType phải là chuỗi và không được để trống');
      const mappedFields = [
        parsed.columns[column],
        ...Object.entries(parsed.additionalFields ?? {})
          .filter(([, source]) => source === column)
          .map(([field]) => field),
      ];
      if (
        transform.type === 'multi_value' &&
        mappedFields.some((field) => !field.endsWith('[0][VALUE]'))
      )
        throw new Error('Trường nhiều giá trị phải dùng định dạng FIELD[0][VALUE]');
    }
    return parsed;
  }
}
