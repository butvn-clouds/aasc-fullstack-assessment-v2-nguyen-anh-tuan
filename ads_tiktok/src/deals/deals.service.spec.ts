import { ConflictException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Deal } from '../database/entities';
import { DealsService } from './deals.service';

describe('DealsService', () => {
  const qb = {
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn().mockResolvedValue([[{ id: 'deal-1' }], 1]),
  };
  const repo = {
    createQueryBuilder: jest.fn(() => qb),
    findOne: jest.fn(),
    create: jest.fn((value) => value),
    save: jest.fn(),
  };
  let service: DealsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DealsService(repo as unknown as Repository<Deal>);
  });

  it('lọc danh sách và giới hạn page, limit an toàn', async () => {
    await expect(service.list({ status: 'won', assigned_to: '7', page: 0, limit: 500 })).resolves.toEqual({
      items: [{ id: 'deal-1' }],
      total: 1,
      page: 1,
      limit: 100,
    });
    expect(qb.skip).toHaveBeenCalledWith(0);
    expect(qb.take).toHaveBeenCalledWith(100);
    expect(qb.andWhere).toHaveBeenNthCalledWith(1, 'd.status = :s', { s: 'won' });
    expect(qb.andWhere).toHaveBeenNthCalledWith(2, 'd.assigned_to = :a', { a: '7' });
  });

  it('tra cứu theo lead, Bitrix ID và ID nội bộ', async () => {
    const deal = { id: 'deal-1' } as Deal;
    repo.findOne.mockResolvedValue(deal);
    await expect(service.findByLead('lead-1', 'mock')).resolves.toBe(deal);
    await expect(service.findByBitrixId(123, 'mock')).resolves.toBe(deal);
    expect(repo.findOne).toHaveBeenNthCalledWith(1, { where: { leadId: 'lead-1', bitrixMode: 'mock' } });
    expect(repo.findOne).toHaveBeenNthCalledWith(2, { where: { bitrix24Id: 123, bitrixMode: 'mock' } });
    await expect(service.getOrFail('deal-1')).resolves.toBe(deal);
    repo.findOne.mockResolvedValueOnce(null);
    await expect(service.getOrFail('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('khôi phục khi insert trùng Bitrix ID của cùng Lead', async () => {
    const existing = { id: 'existing', leadId: 'lead-1', bitrix24Id: 749, bitrixMode: 'real' } as Deal;
    repo.save.mockRejectedValueOnce({ driverError: { code: '23505' } });
    repo.findOne.mockResolvedValueOnce(existing).mockResolvedValueOnce(existing);
    await expect(service.create({ leadId: 'lead-1', bitrix24Id: 749, bitrixMode: 'real' })).resolves.toBe(existing);
  });

  it('không chiếm Deal của Lead khác khi bị trùng khóa', async () => {
    repo.save.mockRejectedValueOnce({ driverError: { code: '23505' } });
    repo.findOne.mockResolvedValueOnce({ leadId: 'other-lead', bitrix24Id: 749 }).mockResolvedValueOnce(null);
    await expect(service.create({ leadId: 'lead-1', bitrix24Id: 749, bitrixMode: 'real' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('tạo mới và lưu deal qua repository', async () => {
    repo.save.mockResolvedValue({ id: 'deal-1' });
    await expect(service.create({ title: 'Test' })).resolves.toEqual({ id: 'deal-1' });
    const existing = { id: 'deal-1' } as Deal;
    await service.save(existing);
    expect(repo.create).toHaveBeenCalledWith({ title: 'Test' });
    expect(repo.save).toHaveBeenNthCalledWith(2, existing);
  });

  it('không lọc khi thiếu tham số và dùng phân trang mặc định', async () => {
    await expect(service.list({})).resolves.toEqual({ items: [{ id: 'deal-1' }], total: 1, page: 1, limit: 10 });
    expect(qb.skip).toHaveBeenCalledWith(0);
    expect(qb.take).toHaveBeenCalledWith(10);
    expect(qb.andWhere).not.toHaveBeenCalled();
  });

  it('tạo Deal cùng outbox trong một transaction', async () => {
    const deal = { id: 'deal-transaction' } as Deal;
    const manager = {
      create: jest.fn((_entity, data) => data),
      save: jest.fn().mockResolvedValue(deal),
    };
    const transaction = jest.fn(async (callback: (value: typeof manager) => Promise<Deal>) => callback(manager));
    Object.defineProperty(repo, 'manager', { configurable: true, value: { transaction } });
    const onCreated = jest.fn().mockResolvedValue(undefined);
    await expect(service.create({ leadId: 'lead-1' }, onCreated)).resolves.toBe(deal);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith(deal, manager);
  });

  it('không nuốt lỗi cơ sở dữ liệu không phải unique violation', async () => {
    const error = { code: '08006', message: 'connection failure' };
    repo.save.mockRejectedValueOnce(error);
    await expect(service.create({ bitrixMode: 'real' })).rejects.toBe(error);
  });

  it('không tự khôi phục unique violation nếu thiếu bitrixMode', async () => {
    const error = { code: '23505' };
    repo.save.mockRejectedValueOnce(error);
    await expect(service.create({ leadId: 'lead-1' })).rejects.toBe(error);
  });

  it('khôi phục theo lead khi ID Bitrix trùng chính xác', async () => {
    const existing = { leadId: 'lead-1', bitrix24Id: 123, bitrixMode: 'real' } as Deal;
    repo.save.mockRejectedValueOnce({ code: '23505' });
    repo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(existing);
    await expect(service.create({ leadId: 'lead-1', bitrix24Id: 123, bitrixMode: 'real' })).resolves.toBe(existing);
  });

  it('báo conflict nếu cùng lead nhưng khác Bitrix ID', async () => {
    repo.save.mockRejectedValueOnce({ code: '23505' });
    repo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ leadId: 'lead-1', bitrix24Id: 999 });
    await expect(service.create({ leadId: 'lead-1', bitrix24Id: 123, bitrixMode: 'real' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
