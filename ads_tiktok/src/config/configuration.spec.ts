import { DEFAULT_RULES } from './configuration';
import { RuleEngineService } from '../deals/rule-engine.service';

describe('Quy tắc mặc định theo chất lượng lead', () => {
  it.each([
    [69, true, null],
    [70, true, 'normal'],
    [84, true, 'normal'],
    [85, true, 'high'],
    [100, false, null],
  ])('điểm %s, có liên hệ %s → ưu tiên %s', (score, contactable, priority) => {
    const result = new RuleEngineService().findMatch(DEFAULT_RULES, { lead: { score, contactable } });
    expect(result?.priority ?? null).toBe(priority);
    if (result) expect(result.probability_mode).toBe('lead_score');
  });
});
