export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const LEAD_COLUMNS = [
  'id',
  'name',
  'email',
  'phone',
  'city',
  'campaign_id',
  'ad_id',
  'score',
  'status',
  'bitrix24_id',
  'deal_stage',
  'deal_status',
  'deal_amount',
  'created_at',
];

export function excelValue(key: string, value: unknown): string | number | boolean | Date | null {
  if (value == null) return null;
  if (value instanceof Date || typeof value === 'number' || typeof value === 'boolean') return value;
  if (key === 'deal_amount' && typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return String(value);
}
