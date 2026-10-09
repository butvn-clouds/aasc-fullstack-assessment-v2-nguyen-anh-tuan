import { BitrixWebhookDto, MockCrmDto, parseCrmDto } from './bitrix.dto';

describe('Kiểm tra dữ liệu CRM tại đầu vào', () => {
  it('chuyển mã giao dịch dạng chuỗi thành số nguyên', () => {
    expect(
      parseCrmDto(BitrixWebhookDto, { auth: { application_token: 'token' }, data: { FIELDS: { ID: '27' } } }).data
        ?.FIELDS?.ID,
    ).toBe(27);
    expect(parseCrmDto(MockCrmDto, { id: '12', start: '0', fields: { TITLE: 'Khách hàng' } }).id).toBe(12);
  });
  it.each([null, [], 'bad', { data: { FIELDS: { ID: -1 } } }, { data: { FIELDS: { ID: 'abc' } } }, { auth: [] }])(
    'từ chối webhook sai dạng %j',
    (value) => {
      expect(() => parseCrmDto(BitrixWebhookDto, value)).toThrow();
    },
  );
  it('từ chối trường giả lập sai kiểu', () => {
    expect(() => parseCrmDto(MockCrmDto, { fields: [] })).toThrow();
    expect(() => parseCrmDto(MockCrmDto, { start: -1 })).toThrow();
  });
});
