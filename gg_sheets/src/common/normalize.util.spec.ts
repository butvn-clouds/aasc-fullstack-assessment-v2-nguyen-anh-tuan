import {
  normalizeBudget,
  normalizeEmail,
  normalizeEnumKey,
  normalizePhone,
} from './normalize.util';

describe('normalizeEmail', () => {
  it('trim va lowercase email', () => {
    expect(normalizeEmail('  John.Doe@EXAMPLE.com  ')).toBe('john.doe@example.com');
  });
  it('tra ve undefined cho gia tri rong', () => {
    expect(normalizeEmail('')).toBeUndefined();
    expect(normalizeEmail(undefined)).toBeUndefined();
    expect(normalizeEmail(null)).toBeUndefined();
  });
});

describe('normalizePhone', () => {
  it('loai bo khoang trang va dau cham/gach ngang', () => {
    expect(normalizePhone('090.123 4567')).toBe('0901234567');
  });
  it('giu dau + o dau neu co', () => {
    expect(normalizePhone('+84 90-123-4567')).toBe('+84901234567');
  });
  it('tra ve undefined cho gia tri rong', () => {
    expect(normalizePhone('')).toBeUndefined();
    expect(normalizePhone('   ')).toBeUndefined();
  });
});

describe('normalizeBudget', () => {
  it('parse chuoi so co dau phay', () => {
    expect(normalizeBudget('10,000,000')).toBe(10000000);
  });
  it('parse dinh dang "10tr" thanh 10 trieu', () => {
    expect(normalizeBudget('10tr')).toBe(10_000_000);
  });
  it('parse dinh dang co don vi VND', () => {
    expect(normalizeBudget('10.000.000 VND')).toBe(10000000);
  });
  it('tra ve undefined neu khong parse duoc', () => {
    expect(normalizeBudget('khong ro')).toBeUndefined();
    expect(normalizeBudget('')).toBeUndefined();
  });
});

describe('normalizeEnumKey', () => {
  it('chuan hoa ve lowercase va thay khoang trang bang gach duoi', () => {
    expect(normalizeEnumKey('  Chờ Xử Lý ')).toBe('chờ_xử_lý');
  });
  it('tra ve undefined cho gia tri rong', () => {
    expect(normalizeEnumKey('')).toBeUndefined();
  });
});
