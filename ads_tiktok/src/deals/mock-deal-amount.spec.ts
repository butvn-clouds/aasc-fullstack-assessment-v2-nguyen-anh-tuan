import { mockDealAmount } from './mock-deal-amount';

describe('mockDealAmount', () => {
  const payload = (id: string) => ({
    mock: true,
    event_id: id,
    custom_questions: [{ question: 'Budget range', answer: '15-25 triệu VND' }],
  });

  it('produces varied, repeatable VND amounts inside the budget', () => {
    const amounts = Array.from({ length: 100 }, (_, i) => {
      const p = payload(String(i));
      const amount = mockDealAmount(p)!;
      expect(amount).toBeGreaterThanOrEqual(15000000);
      expect(amount).toBeLessThanOrEqual(25000000);
      expect(amount % 100000).toBe(0);
      expect(mockDealAmount(p)).toBe(amount);
      return amount;
    });
    expect(new Set(amounts).size).toBeGreaterThan(20);
  });

  it('does not invent amounts for real leads or invalid budgets', () => {
    expect(mockDealAmount({ ...payload('1'), mock: false })).toBeNull();
    expect(mockDealAmount(null)).toBeNull();
    expect(mockDealAmount({ mock: true, custom_questions: {} })).toBeNull();
    for (const answer of ['unknown', '25-15 triệu VND', '0-5 triệu VND']) {
      expect(mockDealAmount({ ...payload('1'), custom_questions: [{ question: 'Budget range', answer }] })).toBeNull();
    }
  });
});
