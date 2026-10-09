import { BadRequestException } from '@nestjs/common';
import { CONFIG_KEYS } from '../common/constants';
import { ConfigController } from './config.controller';

describe('ConfigController', () => {
  const store = { get: jest.fn(), set: jest.fn().mockResolvedValue(undefined) };
  const rules = { validateRule: jest.fn() };
  let controller: ConfigController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new ConfigController(store as any, rules as any);
  });

  it.each(['__proto__[reviewProbe]', 'FIELD[constructor][prototype]', 'EMAIL[0].VALUE'])(
    'không lưu mapping nguy hiểm hoặc sai cú pháp %s',
    async (destination) => {
      await expect(controller.putMappings({ field_mapping: { name: destination } })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(store.set).not.toHaveBeenCalled();
    },
  );

  it('đọc và lưu field mapping theo cấu trúc chuẩn hoặc cấu trúc gọn', async () => {
    store.get.mockResolvedValueOnce({ name: 'TITLE' });
    await expect(controller.getMappings()).resolves.toEqual({ name: 'TITLE' });
    await expect(controller.putMappings({ field_mapping: { name: 'TITLE' } })).resolves.toEqual({ name: 'TITLE' });
    await expect(controller.putMappings({ name: 'TITLE' })).resolves.toEqual({ name: 'TITLE' });
    expect(store.get).toHaveBeenCalledWith(CONFIG_KEYS.MAPPING);
    expect(store.set).toHaveBeenNthCalledWith(1, CONFIG_KEYS.MAPPING, { name: 'TITLE' });
  });

  it('từ chối mapping có giá trị không phải chuỗi', async () => {
    await expect(controller.putMappings({ field_mapping: { name: 123 } as any })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('đọc và kiểm tra danh sách rules trước khi lưu', async () => {
    const dealRules = [
      {
        condition: 'score > 10',
        action: 'create_deal',
        pipeline_id: '1',
        stage_id: 'NEW',
        probability: 30,
      },
    ];
    store.get.mockResolvedValueOnce(dealRules);
    await expect(controller.getRules()).resolves.toEqual(dealRules);
    await expect(controller.putRules({ deal_rules: dealRules })).resolves.toEqual(dealRules);
    await expect(controller.putRules(dealRules)).resolves.toEqual(dealRules);
    expect(rules.validateRule).toHaveBeenCalledTimes(2);
    expect(store.set).toHaveBeenCalledWith(CONFIG_KEYS.RULES, dealRules);
  });

  it('từ chối rules sai định dạng và không lưu', async () => {
    await expect(controller.putRules({} as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(store.set).not.toHaveBeenCalled();
  });

  it('đọc và lưu cấu hình chi phí chiến dịch', async () => {
    const costs = { campaignA: 1000 };
    store.get.mockResolvedValueOnce(costs);
    await expect(controller.getCosts()).resolves.toEqual(costs);
    await expect(controller.putCosts(costs)).resolves.toEqual(costs);
    expect(store.set).toHaveBeenCalledWith(CONFIG_KEYS.COSTS, costs);
  });
});
