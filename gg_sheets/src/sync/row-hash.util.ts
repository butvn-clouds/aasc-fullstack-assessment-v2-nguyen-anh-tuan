import { createHash } from 'crypto';
import parsePhoneNumberFromString from 'libphonenumber-js';
import { FieldTransform } from '../config/mapping-config.service';
import { normalizeBudget } from '../common/normalize.util';

/** Chuẩn hóa văn bản từ bảng tính, không tự thêm chữ số hoặc chấp nhận văn bản lẫn số. */
export function normalizePhone(value: string): string | undefined {
  const text = value
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .replace(/^'/, '');
  if (!/^\+?[\d\s().-]+$/.test(text)) return undefined;
  const parsed = parsePhoneNumberFromString(text, { defaultCountry: 'VN', extract: false });
  return parsed?.isValid() ? parsed.number : undefined;
}

function requirePhone(value: string, column: string): string {
  const phone = normalizePhone(value);
  if (!phone)
    throw new Error(
      `Số điện thoại không hợp lệ tại "${column}": dùng số đầy đủ như 0901234567 hoặc +84901234567. ` +
        'Đặt ô thành văn bản thuần túy; không dùng dạng 9.01E+8. ' +
        'Nếu có nhiều số, dùng dấu phân cách đã cấu hình trong mapping.',
    );
  return phone;
}

export function normalizeContact(
  rowValues: Record<string, string>,
  dedupFields: string[] = ['Email', 'Số điện thoại'],
): { email?: string; phone?: string } {
  const emailColumn = dedupFields.find((column) => /email/i.test(column)) ?? 'Email';
  const phoneColumn =
    dedupFields.find((column) => /phone|điện thoại/i.test(column)) ?? 'Số điện thoại';
  const email = rowValues[emailColumn]?.trim().toLowerCase() || undefined;
  const rawPhone = rowValues[phoneColumn]?.trim() || undefined;
  return { email, phone: rawPhone ? (normalizePhone(rawPhone) ?? rawPhone) : undefined };
}

function setBitrixField(
  fields: Record<string, unknown>,
  path: string,
  value: unknown,
  valueType = 'WORK',
): void {
  const match = path.match(/^([A-Z0-9_]+)\[0\]\[(\w+)\]$/);
  if (match) {
    const [, arrayField, innerKey] = match;
    const arr = (fields[arrayField] as Array<Record<string, unknown>>) ?? [];
    arr[0] = { ...arr[0], [innerKey]: value, VALUE_TYPE: valueType };
    fields[arrayField] = arr;
    return;
  }
  fields[path] = value;
}

export function buildBitrixFields(
  rowValues: Record<string, string>,
  columnMapping: Record<string, string>,
  normalized: { email?: string; phone?: string },
  transforms: Record<string, FieldTransform> = {},
  dedupFields: string[] = ['Email', 'Số điện thoại'],
  additionalFields: Record<string, string> = {},
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const emailColumn = dedupFields.find((column) => /email/i.test(column));
  const phoneColumn = dedupFields.find((column) => /phone|điện thoại/i.test(column));
  for (const [sheetColumn, bitrixField] of [
    ...Object.entries(columnMapping),
    ...Object.entries(additionalFields).map(([field, column]) => [column, field]),
  ]) {
    let value: unknown = rowValues[sheetColumn];
    const transform = transforms[sheetColumn];
    if (transform?.type !== 'multi_value') {
      if (sheetColumn === emailColumn && normalized.email) value = normalized.email;
      if (sheetColumn === phoneColumn && normalized.phone) value = normalized.phone;
    }
    if (value === undefined || String(value).trim() === '') {
      if (transform?.required) throw new Error(`"${sheetColumn}" là bắt buộc`);
      continue;
    }
    if (transform?.type === 'enum') {
      const raw = String(value).trim();
      const mapped =
        transform.values?.[raw] ??
        (Object.values(transform.values ?? {}).includes(raw) ? raw : undefined);
      if (!mapped)
        throw new Error(`Giá trị danh sách lựa chọn không hợp lệ tại "${sheetColumn}": ${value}`);
      value = mapped;
    }
    if (transform?.type === 'date') value = normalizeDate(String(value), sheetColumn);
    if (transform?.type === 'string') value = String(value).trim();
    if (transform?.type === 'enum_normalized') value = String(value).trim();
    if (transform?.type === 'number') {
      value = normalizeBudget(String(value));
      if (value === undefined) throw new Error(`Số không hợp lệ tại "${sheetColumn}"`);
    }
    if (transform?.type === 'multi_value') {
      const values = String(value)
        .split(transform.separator ?? ';')
        .map((item) => item.trim())
        .filter(Boolean);
      if (transform.required && values.length === 0)
        throw new Error(`"${sheetColumn}" là bắt buộc`);
      const match = bitrixField.match(/^([A-Z0-9_]+)\[0\]\[(\w+)\]$/);
      if (!match)
        throw new Error(
          `Ánh xạ nhiều giá trị cho "${sheetColumn}" phải dùng cú pháp FIELD[0][VALUE]`,
        );
      fields[match[1]] = values.map((item) => {
        if (match[1] === 'EMAIL') {
          item = item.toLowerCase();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item))
            throw new Error(`Email không hợp lệ tại "${sheetColumn}"`);
        }
        if (match[1] === 'PHONE') {
          item = requirePhone(item, sheetColumn);
        }
        return { [match[2]]: item, VALUE_TYPE: transform.valueType ?? 'WORK' };
      });
      continue;
    }
    if (bitrixField === 'PHONE[0][VALUE]') value = requirePhone(String(value), sheetColumn);
    if (bitrixField === 'EMAIL[0][VALUE]') {
      value = String(value).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value)))
        throw new Error(`Email không hợp lệ tại "${sheetColumn}"`);
    }
    if (bitrixField === 'ASSIGNED_BY_ID' && !/^[1-9]\d*$/.test(String(value)))
      throw new Error(`"${sheetColumn}" phải là ID số của người dùng Bitrix, không phải tên`);
    setBitrixField(fields, bitrixField, value, transform?.valueType);
  }
  return fields;
}

function normalizeDate(value: string, column: string): string {
  const text = value.trim();
  const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match && !iso)
    throw new Error(`Ngày không hợp lệ tại "${column}": dùng DD/MM/YYYY hoặc YYYY-MM-DD`);
  const [year, month, day] = match
    ? [Number(match[3]), Number(match[2]), Number(match[1])]
    : [Number(iso![1]), Number(iso![2]), Number(iso![3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    throw new Error(`Ngày không hợp lệ tại "${column}": ${value}`);
  return date.toISOString().slice(0, 10);
}

export function computeRowHash(fields: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex').slice(0, 16);
}
