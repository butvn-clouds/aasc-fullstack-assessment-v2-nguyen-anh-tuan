import { normalizeEmail, normalizePhone, sanitizeText } from './normalize';

describe('normalize', () => {
  it('chuẩn hóa SĐT VN về E.164', () => {
    expect(normalizePhone('0901234567')).toBe('+84901234567');
    expect(normalizePhone('+84 901 234 567')).toBe('+84901234567');
  });
  it('trả null cho SĐT sai', () => {
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });
  it('chuẩn hóa email', () => {
    expect(normalizeEmail('  NguyenVanA@Email.COM ')).toBe('nguyenvana@email.com');
    expect(normalizeEmail('not-an-email')).toBeNull();
  });
  it('sanitize loại tag và ký tự điều khiển', () => {
    expect(sanitizeText('<b>Hà</b>\u0000 Nội  ')).toBe('Hà Nội');
    expect(sanitizeText('x'.repeat(500), 10)).toHaveLength(10);
  });
});
