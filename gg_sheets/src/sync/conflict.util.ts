import { MappingConfig } from '../config/mapping-config.service';
import { CrmLead } from '../bitrix24/bitrix24-client.service';

/** Chỉ các trường được chọn mới được kéo về; không tự nhập Lead bên ngoài Sheet. */
export function reverseMapping(config: MappingConfig): Record<string, string> {
  return (
    config.reverseColumns ??
    Object.fromEntries(
      Object.entries(config.columns)
        .filter(([, field]) => ['STATUS_ID', 'ASSIGNED_BY_ID'].includes(field))
        .map(([column, field]) => [field, column]),
    )
  );
}

export function crmChanged(date?: string, baseline?: string): boolean {
  if (!baseline) return true;
  if (!date) throw new Error('CRM không trả DATE_MODIFY; chưa thể đối chiếu an toàn');
  const current = Date.parse(date),
    previous = Date.parse(baseline);
  if (!Number.isFinite(current)) throw new Error('DATE_MODIFY không hợp lệ');
  return !Number.isFinite(previous) || current > previous;
}

export function reverseValues(lead: CrmLead, config: MappingConfig): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [path, column] of Object.entries(reverseMapping(config))) {
    const match = path.match(/^([A-Z0-9_]+)\[0\]\[(\w+)\]$/);
    let value = lead[match?.[1] ?? path];
    if (value === undefined) continue;
    const transform = config.transforms?.[column];
    if (Array.isArray(value)) {
      const items = value.map((item) =>
        typeof item === 'object' && item !== null ? (item[match?.[2] ?? 'VALUE'] ?? '') : item,
      );
      value =
        transform?.type === 'multi_value'
          ? items.join(transform.separator ?? ';')
          : match
            ? (items[0] ?? '')
            : items.join(';');
    }
    let text = value == null ? '' : String(value);
    if (transform?.type === 'enum')
      text = Object.entries(transform.values ?? {}).find(([, id]) => id === text)?.[0] ?? text;
    if (transform?.type === 'date' && text) text = text.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? text;
    values[column] = text;
  }
  return values;
}
