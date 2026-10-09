import { scoreLead } from './scoring';

describe('scoreLead', () => {
  it('tính điểm theo độ đầy đủ', () => {
    expect(scoreLead({ email: 'a@b.co', phone: '+84901234567', city: 'HN', answers: 2 })).toBe(80);
    expect(scoreLead({ email: null, phone: null, answers: 0 })).toBe(0);
  });
  it('tối đa 100', () => {
    expect(scoreLead({ email: 'a@b.co', phone: '+84901234567', city: 'HN', answers: 10 })).toBe(100);
  });
});
