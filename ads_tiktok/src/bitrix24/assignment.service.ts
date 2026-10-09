import { Injectable } from '@nestjs/common';
import { RedisService } from '../common/redis.service';
import { DealRule } from '../deals/rule-engine.service';

@Injectable()
export class AssignmentService {
  constructor(private readonly redis: RedisService) {}

  /** Round-robin bằng bộ đếm Redis (atomic INCR) hoặc chỉ định cố định. */
  async pick(rule: DealRule): Promise<string | null> {
    const users = rule.assign_to?.users ?? [];
    if (!users.length) return null;
    if (rule.assign_to?.strategy === 'fixed' || users.length === 1) return String(users[0]);
    const n = await this.redis.incr(`rr:${rule.pipeline_id}:${rule.stage_id}`);
    return String(users[(n - 1) % users.length]);
  }
}
