import { CountryCode, parsePhoneNumberFromString } from 'libphonenumber-js';

/** Chuẩn hóa số điện thoại về E.164. Trả null nếu không hợp lệ. */
export function normalizePhone(raw?: string | null, region: string = 'VN'): string | null {
  if (!raw) return null;
  const parsed = parsePhoneNumberFromString(raw.trim(), region as CountryCode);
  return parsed && parsed.isValid() ? parsed.number : null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(raw?: string | null): string | null {
  if (!raw) return null;
  const email = raw.trim().toLowerCase();
  return EMAIL_RE.test(email) && email.length <= 255 ? email : null;
}

export function sanitizeText(raw?: string | null, max = 255): string {
  if (!raw) return '';
  return String(raw)
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
