import { MockLeadFactory, pickMockLeadQuality } from './mock-lead.factory';
import { normalizeEmail, normalizePhone } from '../common/normalize';
import { scoreLead } from '../leads/scoring';
import { DEFAULT_RULES } from '../config/configuration';
import { RuleEngineService } from '../deals/rule-engine.service';

describe('MockLeadFactory', () => {
  it.each([
    ['weak', 30, null],
    ['interested', 60, null],
    ['qualified', 80, 'normal'],
    ['priority', 90, 'high'],
  ] as const)('hồ sơ %s có điểm %s và rule %s', (quality, expectedScore, priority) => {
    const payload = new MockLeadFactory().create(undefined, quality);
    const score = scoreLead({
      email: normalizeEmail(payload.lead_data.email),
      phone: normalizePhone(payload.lead_data.phone),
      city: payload.lead_data.city,
      answers: payload.custom_questions!.length,
    });
    expect(score).toBe(expectedScore);
    const rule = new RuleEngineService().findMatch(DEFAULT_RULES, {
      ...payload,
      lead: { score, contactable: true },
    });
    expect(rule?.priority ?? null).toBe(priority);
  });
  it('phân bổ chất lượng theo trọng số 30/30/25/15', () => {
    const counts = { weak: 0, interested: 0, qualified: 0, priority: 0 };
    for (let roll = 0; roll < 100; roll++) counts[pickMockLeadQuality(roll)]++;
    expect(counts).toEqual({ weak: 30, interested: 30, qualified: 25, priority: 15 });
  });
  it('generates varied contacts with consistent campaign, ad and product details', () => {
    const factory = new MockLeadFactory();
    const leads = Array.from({ length: 1000 }, () => factory.create());
    for (const field of ['email', 'phone', 'ttclid'] as const) {
      const values = leads.map((p) => p.lead_data[field]).filter(Boolean);
      expect(new Set(values).size).toBe(values.length);
    }
    expect(new Set(leads.map((p) => p.lead_data.full_name)).size).toBeGreaterThan(100);
    expect(new Set(leads.map((p) => p.campaign.campaign_id)).size).toBe(3);
    const ads = new Map<string, string>();
    for (const p of leads) {
      expect(normalizePhone(p.lead_data.phone)).toBe(p.lead_data.phone ?? null);
      expect(normalizeEmail(p.lead_data.email)).toBe(p.lead_data.email);
      expect(p.campaign.campaign_id).toMatch(/^\d{19}$/);
      expect(p.campaign.ad_id).toMatch(/^\d{19}$/);
      const identity = JSON.stringify([p.campaign.campaign_id, p.campaign.ad_name]);
      const adId = p.campaign.ad_id!;
      if (ads.has(adId)) expect(ads.get(adId)).toBe(identity);
      ads.set(adId, identity);
      const slug = p.lead_data.utm_campaign!;
      expect(slug).toContain(p.form.form_id.replace('form_', ''));
      if (slug.startsWith('smartphone')) {
        expect(p.lead_data.interests![0]).toBe('điện thoại');
        expect(p.custom_questions![0].answer).toMatch(/^(5-10|10-15|15-25) triệu VND$/);
      } else if (slug.startsWith('laptop')) {
        expect(p.lead_data.interests![0]).toBe('laptop');
        expect(p.custom_questions![0].answer).toMatch(/^(10-15|15-25|25-40) triệu VND$/);
      } else {
        expect(p.lead_data.interests![0]).toBe('nhà thông minh');
        expect(p.custom_questions![0].answer).toMatch(/^(3-5|5-10|10-20) triệu VND$/);
      }
    }
  });
});
