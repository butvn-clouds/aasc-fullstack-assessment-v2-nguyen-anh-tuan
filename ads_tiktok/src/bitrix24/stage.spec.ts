import { stageToStatus } from './bitrix24-webhook.controller';

describe('stageToStatus', () => {
  it('map stage Bitrix24 sang status nội bộ', () => {
    expect(stageToStatus('WON')).toBe('won');
    expect(stageToStatus('C1:WON')).toBe('won');
    expect(stageToStatus('LOSE')).toBe('lost');
    expect(stageToStatus('NEW')).toBe('open');
  });
});
