import { RedisService } from '../common/redis.service';
import { AssignmentService } from './assignment.service';
import { DealRule } from '../deals/rule-engine.service';

describe('AssignmentService', () => {
  const redis = { incr: jest.fn() };
  let service: AssignmentService;
  const rule = (assign_to: DealRule['assign_to']): DealRule => ({
    condition: 'score > 0',
    action: 'create_deal',
    pipeline_id: 'sales',
    stage_id: 'new',
    probability: 0,
    assign_to,
  });

  beforeEach(() => {
    redis.incr.mockReset();
    service = new AssignmentService(redis as unknown as RedisService);
  });

  it('returns null when no assignment users are configured', async () => {
    await expect(service.pick(rule({ strategy: 'fixed', users: [] }))).resolves.toBeNull();
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it('returns the configured fixed user without using Redis', async () => {
    await expect(service.pick(rule({ strategy: 'fixed', users: [27, 31] }))).resolves.toBe('27');
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it('uses the only configured user without incrementing a counter', async () => {
    await expect(service.pick(rule({ strategy: 'round_robin', users: [42] }))).resolves.toBe('42');
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it('round-robins with an atomic Redis counter scoped to pipeline and stage', async () => {
    redis.incr.mockResolvedValueOnce(1).mockResolvedValueOnce(2).mockResolvedValueOnce(3);
    const roundRobinRule = rule({ strategy: 'round_robin', users: [7, 8] });

    await expect(service.pick(roundRobinRule)).resolves.toBe('7');
    await expect(service.pick(roundRobinRule)).resolves.toBe('8');
    await expect(service.pick(roundRobinRule)).resolves.toBe('7');
    expect(redis.incr).toHaveBeenCalledTimes(3);
    expect(redis.incr).toHaveBeenCalledWith('rr:sales:new');
  });
});
