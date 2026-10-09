import { buildBitrixFields, setBitrixField } from './bitrix-mapper';

describe('bitrix mapper', () => {
  it.each([
    '__proto__[reviewProbe]',
    'constructor[prototype][reviewProbe]',
    'FIELD[__proto__][reviewProbe]',
    'FIELD[constructor]',
    'FIELD[prototype]',
    '__proto__',
  ])('chặn đường dẫn nguy hiểm %s trước khi ghi dữ liệu', (key) => {
    const target = {};
    expect(() => setBitrixField(target, key, true)).toThrow();
    expect(target).toEqual({});
    expect(Object.prototype).not.toHaveProperty('reviewProbe');
  });
  it.each(['', 'EMAIL[0][VALUE', 'EMAIL[0].VALUE', 'FIELD[]'])('từ chối đường dẫn sai cú pháp %s', (key) => {
    expect(() => setBitrixField({}, key, 'value')).toThrow();
  });
  it('không đi theo thuộc tính kế thừa và chặn mapping cũ ngay cả khi không có dữ liệu nguồn', () => {
    const inherited = { FIELD: {} };
    const target = Object.create(inherited);
    setBitrixField(target, 'FIELD[VALUE]', 'safe');
    expect(inherited.FIELD).toEqual({});
    expect(target.FIELD).toEqual({ VALUE: 'safe' });
    expect(() => buildBitrixFields({ missing: '__proto__[reviewProbe]' }, {})).toThrow();
  });
  it('map key dạng EMAIL[0][VALUE] thành cấu trúc lồng', () => {
    const t: any = {};
    setBitrixField(t, 'EMAIL[0][VALUE]', 'a@b.co');
    expect(t).toEqual({ EMAIL: [{ VALUE: 'a@b.co' }] });
  });
  it('build fields từ payload TikTok và bỏ giá trị rỗng', () => {
    const fields = buildBitrixFields(
      { 'lead_data.full_name': 'NAME', 'lead_data.email': 'EMAIL[0][VALUE]', 'lead_data.city': 'UF_CRM_CITY' },
      { lead_data: { full_name: 'A', email: 'a@b.co', city: '' } },
    );
    expect(fields).toEqual({ NAME: 'A', EMAIL: [{ VALUE_TYPE: 'WORK', VALUE: 'a@b.co' }] });
  });
});

import { appendExtraContacts } from './bitrix-mapper';

describe('appendExtraContacts', () => {
  it('thêm email/SĐT phụ vào trường đa giá trị và không trùng', () => {
    const fields: Record<string, any> = { EMAIL: [{ VALUE: 'a@x.com', VALUE_TYPE: 'WORK' }] };
    appendExtraContacts(fields, { emails: ['a@x.com', 'b@x.com'], phones: ['+84901111111'] });
    expect(fields.EMAIL).toEqual([
      { VALUE: 'a@x.com', VALUE_TYPE: 'WORK' },
      { VALUE: 'b@x.com', VALUE_TYPE: 'WORK' },
    ]);
    expect(fields.PHONE).toEqual([{ VALUE: '+84901111111', VALUE_TYPE: 'WORK' }]);
  });

  it('không làm gì khi không có giá trị phụ', () => {
    const fields: Record<string, any> = {};
    appendExtraContacts(fields, undefined);
    appendExtraContacts(fields, { emails: [], phones: [] });
    expect(fields).toEqual({});
  });
});
