import { BadRequestException } from '@nestjs/common';
import { RuleEngineService } from './rule-engine.service';

describe('RuleEngineService', () => {
  const engine = new RuleEngineService();
  const ctx = {
    campaign: { campaign_name: 'Spring Sale 2024' },
    lead: { score: 80 },
    lead_data: { interests: ['technology'] },
  };

  it('CONTAINS không phân biệt hoa thường', () => {
    expect(engine.evaluateCondition("campaign.campaign_name CONTAINS 'sale'", ctx)).toBe(true);
    expect(engine.evaluateCondition("campaign.campaign_name CONTAINS 'winter'", ctx)).toBe(false);
  });
  it('so sánh số và AND', () => {
    expect(engine.evaluateCondition("lead.score >= 70 AND campaign.campaign_name CONTAINS 'sale'", ctx)).toBe(true);
    expect(engine.evaluateCondition('lead.score < 50', ctx)).toBe(false);
  });
  it('CONTAINS trên mảng', () => {
    expect(engine.evaluateCondition("lead_data.interests CONTAINS 'technology'", ctx)).toBe(true);
  });
  it('findMatch trả rule đầu tiên khớp', () => {
    const rules: any[] = [
      {
        condition: "campaign.campaign_name CONTAINS 'x'",
        action: 'create_deal',
        pipeline_id: '1',
        stage_id: 'A',
        probability: 1,
      },
      {
        condition: "campaign.campaign_name CONTAINS 'sale'",
        action: 'create_deal',
        pipeline_id: '1',
        stage_id: 'B',
        probability: 2,
      },
    ];
    expect(engine.findMatch(rules, ctx)?.stage_id).toBe('B');
    expect(engine.findMatch([], ctx)).toBeNull();
  });
  it('từ chối condition sai cú pháp', () => {
    expect(() => engine.evaluateCondition('foo bar', ctx)).toThrow(BadRequestException);
    expect(() => engine.validateRule({ condition: 'x', action: 'create_deal' })).toThrow(BadRequestException);
    const validRule = {
      condition: "a CONTAINS 'b'",
      action: 'create_deal',
      pipeline_id: '1',
      stage_id: 'NEW',
      probability: 30,
    };
    expect(() => engine.validateRule(validRule)).not.toThrow();
    expect(() => engine.validateRule({ ...validRule, probability: 200 })).toThrow(BadRequestException);
    expect(() => engine.validateRule({ ...validRule, pipeline_id: '' })).toThrow(BadRequestException);
    expect(() => engine.validateRule({ ...validRule, stage_id: undefined })).toThrow(BadRequestException);
    expect(() => engine.validateRule({ ...validRule, assign_to: { strategy: 'round_robin', users: [] } })).toThrow(
      BadRequestException,
    );
  });
  it.each([
    ["missing EQUALS ''", true],
    ['lead.score != 20', true],
    ['lead.score == 80', true],
    ['lead.score > 80', false],
    ['lead.score <= 80', true],
    ["campaign.campaign_name NOT_CONTAINS 'winter'", true],
    ['lead.score EQUALS "80"', true],
  ])('evaluates %s', (condition, expected) => expect(engine.evaluateCondition(condition, ctx)).toBe(expected));
  it('validates probability modes and amounts', () => {
    const rule = {
      condition: "a CONTAINS 'b'",
      action: 'create_deal',
      pipeline_id: '1',
      stage_id: 'NEW',
      probability: 30,
    };
    expect(() => engine.validateRule(rule)).not.toThrow();
    expect(() => engine.validateRule({ ...rule, probability_mode: 'lead_score', amount: 100 })).not.toThrow();
    expect(() => engine.validateRule({ ...rule, probability_mode: 'unknown' })).toThrow();
    expect(() => engine.validateRule({ ...rule, amount: -1 })).toThrow();
    expect(() => engine.validateRule(null)).toThrow();
    expect(engine.findMatch(undefined as any, {})).toBeNull();
  });
});
