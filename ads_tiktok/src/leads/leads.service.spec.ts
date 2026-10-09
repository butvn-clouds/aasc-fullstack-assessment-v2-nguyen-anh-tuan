import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { Lead, LeadEvent } from '../database/entities';
import { LeadsService, UpsertInput, mergeRawData } from './leads.service';

describe('LeadsService', () => {
  let service: LeadsService;
  let manager: { query: jest.Mock; getRepository: jest.Mock };
  let leadRepository: {
    create: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
    findOne: jest.Mock;
  };
  let eventRepository: { save: jest.Mock; create: jest.Mock; find: jest.Mock };
  let queryBuilder: Record<string, jest.Mock>;
  let dataSource: { transaction: jest.Mock };
  const input: UpsertInput = {
    externalId: 'click-1',
    name: 'Nguyễn Văn A',
    email: 'a@example.com',
    phone: '+84901234567',
    city: 'Hà Nội',
    campaignId: 'campaign-1',
    adId: 'ad-1',
    formId: 'form-1',
    score: 80,
    rawData: { lead_data: { full_name: 'Nguyễn Văn A' } },
  };

  beforeEach(() => {
    queryBuilder = {
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
      andWhere: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    leadRepository = {
      create: jest.fn((value) => ({ ...value })),
      save: jest.fn().mockImplementation(async (value) => value),
      createQueryBuilder: jest.fn(() => queryBuilder),
      findOne: jest.fn(),
    };
    eventRepository = {
      create: jest.fn((value) => ({ ...value })),
      save: jest.fn().mockImplementation(async (value) => value),
      find: jest.fn().mockResolvedValue([]),
    };
    manager = {
      query: jest.fn().mockResolvedValue(undefined),
      getRepository: jest.fn((entity) => (entity === Lead ? leadRepository : eventRepository)),
    };
    dataSource = { transaction: jest.fn((work) => work(manager)) };
    service = new LeadsService(
      leadRepository as unknown as Repository<Lead>,
      eventRepository as unknown as Repository<LeadEvent>,
      dataSource as unknown as DataSource,
    );
  });

  it('tạo lead mới dưới advisory lock và ghi timeline', async () => {
    leadRepository.save.mockImplementationOnce(async (value) => ({ id: 'new-lead', ...value }));
    const result = await service.upsert(input);

    expect(manager.query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtext($1))', [`email:${input.email}`]);
    expect(leadRepository.create).toHaveBeenCalledWith({ ...input, source: 'tiktok', status: 'new' });
    expect(eventRepository.save).toHaveBeenCalledWith({
      leadId: 'new-lead',
      type: 'created',
      message: 'Đã tạo khách hàng tiềm năng từ TikTok',
      meta: { campaignId: input.campaignId, adId: input.adId },
    });
    expect(result).toEqual({ lead: { id: 'new-lead', ...input, source: 'tiktok', status: 'new' }, created: true });
  });

  it('merge giá trị còn thiếu, giữ score cao và lưu raw payload mới', async () => {
    const existing = {
      id: 'lead-1',
      externalId: 'old-click',
      email: input.email,
      phone: null,
      city: 'Hà Nội cũ',
      campaignId: 'campaign-old',
      adId: null,
      formId: null,
      score: 95,
    } as Lead;
    queryBuilder.getOne.mockResolvedValueOnce(existing);

    const result = await service.upsert({ ...input, score: 70 });

    expect(result.created).toBe(false);
    expect(result.lead).toMatchObject({
      id: 'lead-1',
      externalId: 'old-click',
      email: input.email,
      phone: input.phone,
      city: 'Hà Nội cũ',
      campaignId: 'campaign-old',
      adId: input.adId,
      formId: input.formId,
      score: 95,
      rawData: input.rawData,
    });
    expect(eventRepository.save).toHaveBeenCalledWith({
      leadId: 'lead-1',
      type: 'merged',
      message: 'Đã gộp dữ liệu gửi trùng',
      meta: { externalId: input.externalId },
    });
  });

  it('lưu email/SĐT khác vào extra_contacts, không ghi đè giá trị chính và ghi vào timeline', async () => {
    const existing = {
      id: 'lead-1',
      externalId: 'old-click',
      email: 'old@example.com',
      phone: '+84900000000',
      city: null,
      campaignId: 'c',
      adId: 'a',
      formId: 'f',
      score: 10,
      rawData: null,
      extraContacts: { emails: [], phones: ['+84911111111'] },
    } as unknown as Lead;
    queryBuilder.getOne.mockResolvedValueOnce(existing);

    const { lead } = await service.upsert({ ...input, phone: '+84922222222' });

    expect(lead.email).toBe('old@example.com');
    expect(lead.phone).toBe('+84900000000');
    expect(lead.extraContacts).toEqual({ emails: ['a@example.com'], phones: ['+84911111111', '+84922222222'] });
    expect(eventRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'merged',
        meta: { externalId: input.externalId, addedEmails: ['a@example.com'], addedPhones: ['+84922222222'] },
      }),
    );
  });

  it('không thêm trùng giá trị đã có trong extra_contacts và dedup theo cả giá trị phụ', async () => {
    const existing = {
      id: 'lead-1',
      email: 'old@example.com',
      phone: null,
      score: 1,
      rawData: null,
      extraContacts: { emails: ['a@example.com'], phones: [] },
    } as unknown as Lead;
    queryBuilder.getOne.mockResolvedValueOnce(existing);

    const { lead } = await service.upsert(input);

    expect(lead.extraContacts.emails).toEqual(['a@example.com']);
    expect(queryBuilder.where).toHaveBeenCalledWith(
      expect.stringContaining(`l.extra_contacts->'emails' @> to_jsonb(CAST(:email AS text))`),
      expect.objectContaining({ email: input.email }),
    );
  });

  describe('mergeRawData', () => {
    it('lấy payload mới khi chưa có dữ liệu cũ', () => {
      const incoming = { campaign: { campaign_name: 'N' } };
      expect(mergeRawData(null, incoming)).toBe(incoming);
    });

    it('giữ attribution first-touch, các phần khác lấy bản mới', () => {
      const merged = mergeRawData(
        {
          campaign: { campaign_name: 'First' },
          form: { form_id: 'f1' },
          lead_data: { ttclid: 'TT-1', city: 'A' },
        },
        {
          event_id: 'e2',
          campaign: { campaign_name: 'Second' },
          form: { form_id: 'f2' },
          lead_data: { ttclid: 'TT-2', city: 'B' },
          custom_questions: [{ question: 'q', answer: 'a' }],
        },
      );
      expect(merged).toEqual({
        event_id: 'e2',
        campaign: { campaign_name: 'First' },
        form: { form_id: 'f1' },
        lead_data: { ttclid: 'TT-1', city: 'B' },
        custom_questions: [{ question: 'q', answer: 'a' }],
      });
    });

    it('dùng attribution mới nếu bản cũ thiếu', () => {
      const merged = mergeRawData({ lead_data: {} }, { campaign: { campaign_name: 'N' }, lead_data: { ttclid: 'T' } });
      expect(merged).toMatchObject({ campaign: { campaign_name: 'N' }, lead_data: { ttclid: 'T' } });
    });
  });

  describe('withSyncLock và recordInteraction', () => {
    let runner: { connect: jest.Mock; query: jest.Mock; release: jest.Mock };

    beforeEach(() => {
      runner = {
        connect: jest.fn().mockResolvedValue(undefined),
        query: jest.fn().mockResolvedValue(undefined),
        release: jest.fn().mockResolvedValue(undefined),
      };
      (dataSource as any).createQueryRunner = jest.fn(() => runner);
    });

    it('khóa, chạy việc, rồi mở khóa và trả kết quả', async () => {
      await expect(service.withSyncLock('l1', async () => 42)).resolves.toBe(42);
      expect(runner.query).toHaveBeenNthCalledWith(1, 'SELECT pg_advisory_lock(hashtext($1))', ['crm-sync:l1']);
      expect(runner.query).toHaveBeenNthCalledWith(2, 'SELECT pg_advisory_unlock(hashtext($1))', ['crm-sync:l1']);
      expect(runner.release).toHaveBeenCalled();
    });

    it('vẫn mở khóa và giải phóng kết nối khi công việc lỗi', async () => {
      await expect(
        service.withSyncLock('l1', async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(runner.query).toHaveBeenCalledWith('SELECT pg_advisory_unlock(hashtext($1))', ['crm-sync:l1']);
      expect(runner.release).toHaveBeenCalled();
    });

    it('không unlock nếu chưa lấy được khóa nhưng vẫn release', async () => {
      runner.query.mockRejectedValueOnce(new Error('lock fail'));
      await expect(service.withSyncLock('l1', async () => 1)).rejects.toThrow('lock fail');
      expect(runner.query).toHaveBeenCalledTimes(1);
      expect(runner.release).toHaveBeenCalled();
    });

    it('cộng điểm tương tác một lần: form.complete +10, sự kiện khác +5', async () => {
      manager.query.mockImplementation(async (sql: string) =>
        sql.includes('INSERT INTO lead_events') ? [{ id: 1 }] : undefined,
      );
      await service.recordInteraction('l1', 'form.complete', 'e1');
      await service.recordInteraction('l1', 'user.interact', 'e2');
      const updates = manager.query.mock.calls.filter(([sql]) => String(sql).startsWith('UPDATE leads'));
      expect(updates.map(([, params]) => params)).toEqual([
        ['l1', 10],
        ['l1', 5],
      ]);
    });

    it('bỏ qua sự kiện tương tác đã ghi (không cộng điểm lần hai)', async () => {
      manager.query.mockImplementation(async (sql: string) =>
        sql.includes('INSERT INTO lead_events') ? [] : undefined,
      );
      await service.recordInteraction('l1', 'form.complete', 'e1');
      expect(manager.query.mock.calls.some(([sql]) => String(sql).startsWith('UPDATE leads'))).toBe(false);
    });
  });

  it('lọc danh sách và chặn page/limit ngoài biên', async () => {
    queryBuilder.getManyAndCount.mockResolvedValueOnce([[{ id: 'lead-1' }], 1]);

    const result = await service.list({ page: -3, limit: 500, source: 'tiktok', status: 'new', campaign_id: 'c-1' });

    expect(queryBuilder.skip).toHaveBeenCalledWith(0);
    expect(queryBuilder.take).toHaveBeenCalledWith(100);
    expect(queryBuilder.andWhere).toHaveBeenNthCalledWith(1, 'l.source = :src', { src: 'tiktok' });
    expect(queryBuilder.andWhere).toHaveBeenNthCalledWith(2, 'l.status = :st', { st: 'new' });
    expect(queryBuilder.andWhere).toHaveBeenNthCalledWith(3, 'l.campaign_id = :c', { c: 'c-1' });
    expect(result).toEqual({ items: [{ id: 'lead-1' }], total: 1, page: 1, limit: 100 });
  });

  it('đưa limit sai/nhỏ về biên tối thiểu và bỏ bộ lọc không có giá trị', async () => {
    await service.list({ page: 2, limit: 0, source: '' });

    expect(queryBuilder.skip).toHaveBeenCalledWith(1);
    expect(queryBuilder.take).toHaveBeenCalledWith(1);
    expect(queryBuilder.andWhere).not.toHaveBeenCalled();
  });

  it('báo không tìm thấy lead', async () => {
    leadRepository.findOne.mockResolvedValueOnce(null);

    await expect(service.getOrFail('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('ủy quyền các thao tác timeline và tra cứu cho repository', async () => {
    const lead = { id: 'lead-1' } as Lead;
    const savedEvent = { leadId: lead.id, type: 'note', message: 'hello', meta: null };
    eventRepository.create.mockReturnValueOnce(savedEvent);
    eventRepository.find.mockResolvedValueOnce([savedEvent]);
    leadRepository.findOne.mockResolvedValueOnce(lead);

    await expect(service.getOrFail(lead.id)).resolves.toBe(lead);
    await service.addEvent(lead.id, 'note', 'hello');
    await expect(service.getTimeline(lead.id)).resolves.toEqual([savedEvent]);
    expect(eventRepository.create).toHaveBeenCalledWith(savedEvent);
    expect(eventRepository.find).toHaveBeenCalledWith({ where: { leadId: lead.id }, order: { createdAt: 'ASC' } });
  });
});
