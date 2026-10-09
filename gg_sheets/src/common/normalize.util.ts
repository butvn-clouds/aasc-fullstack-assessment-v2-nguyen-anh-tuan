export function normalizeEmail(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Chuan hoa so dien thoai ve dang chi con chu so va dau '+' o dau (E.164-ish).
 * Vi du: "090.123 4567" -> "0901234567"; "+84 90-123-4567" -> "+84901234567".
 * Neu so bat dau bang "0" va co 9-10 chu so, giu nguyen (khong tu doi sang +84)
 * de tranh sai lech neu doanh nghiep dang dung format noi dia.
 */
export function normalizePhone(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  const hasPlus = trimmed.startsWith('+');
  const digitsOnly = trimmed.replace(/[^\d]/g, '');
  if (digitsOnly.length === 0) return undefined;
  return hasPlus ? `+${digitsOnly}` : digitsOnly;
}

/**
 * Parse ngan sach dang chuoi (vd: "10,000,000", "10.000.000 VND", "10tr") ve so nguyen.
 * Tra ve undefined neu khong parse duoc, tranh crash toan bo dong bo vi 1 gia tri sai.
 */
export function normalizeBudget(raw: string | undefined | null): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  const trimmed = String(raw).trim().toLowerCase();
  if (trimmed.length === 0) return undefined;

  const millionMatch = trimmed.match(/^([\d.,]+)\s*tr(iệu)?$/);
  if (millionMatch) {
    const num = parseFloat(millionMatch[1].replace(/,/g, ''));
    return isNaN(num) ? undefined : Math.round(num * 1_000_000);
  }

  const cleaned = trimmed.replace(/[^\d]/g, '');
  if (cleaned.length === 0) return undefined;
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? undefined : num;
}

/**
 * Chuan hoa gia tri enum/status ve dang so sanh khong phan biet hoa-thuong, khoang trang.
 */
export function normalizeEnumKey(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  return raw.trim().toLowerCase().replace(/\s+/g, '_');
}
