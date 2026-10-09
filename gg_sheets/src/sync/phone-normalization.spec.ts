import { buildBitrixFields, normalizeContact, normalizePhone } from './row-hash.util';

describe('spreadsheet phone normalization', () => {
  it.each([
    '0901234567',
    '901234567',
    '+84901234567',
    '84901234567',
    '0901 234 567',
    "'0901234567",
    '０９０１２３４５６７',
    '0901\u200b234567',
  ])('normalizes %s consistently for payload and duplicate lookup', (value) => {
    expect(normalizePhone(value)).toBe('+84901234567');
    expect(normalizeContact({ 'Số điện thoại': value }).phone).toBe('+84901234567');
    const fields = buildBitrixFields({ Phone: value }, { Phone: 'PHONE[0][VALUE]' }, {});
    expect(fields.PHONE).toEqual([{ VALUE: '+84901234567', VALUE_TYPE: 'WORK' }]);
  });

  it.each(['abc', '123', '9.01E+8', 'Call 0901234567', '0901234567;0912345678'])(
    'rejects ambiguous or invalid single values: %s',
    (value) => {
      expect(normalizePhone(value)).toBeUndefined();
      expect(() => buildBitrixFields({ Phone: value }, { Phone: 'PHONE[0][VALUE]' }, {})).toThrow(
        'Số điện thoại không hợp lệ',
      );
    },
  );

  it('normalizes each multi-value entry and rejects an invalid entry', () => {
    const build = (value: string) =>
      buildBitrixFields(
        { Phone: value },
        { Phone: 'PHONE[0][VALUE]' },
        {},
        { Phone: { type: 'multi_value', separator: ';' } },
      );
    expect(build('0901\u200b234567;0912345678').PHONE).toEqual([
      { VALUE: '+84901234567', VALUE_TYPE: 'WORK' },
      { VALUE: '+84912345678', VALUE_TYPE: 'WORK' },
    ]);
    expect(() => build('0901234567;abc')).toThrow('Số điện thoại không hợp lệ');
  });
});
