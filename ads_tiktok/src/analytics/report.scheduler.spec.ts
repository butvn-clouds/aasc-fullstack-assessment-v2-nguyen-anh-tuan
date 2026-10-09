import { ConfigService } from '@nestjs/config';
import { NotificationService } from '../bitrix24/notification.service';
import { AnalyticsService } from './analytics.service';
import { ReportScheduler } from './report.scheduler';

describe('ReportScheduler', () => {
  const analytics = { conversionRates: jest.fn() };
  const notifier = { notify: jest.fn() };
  const config = { get: jest.fn(() => 0.05) };
  let scheduler: ReportScheduler;

  beforeEach(() => {
    jest.clearAllMocks();
    config.get.mockReturnValue(0.05);
    scheduler = new ReportScheduler(
      analytics as unknown as AnalyticsService,
      notifier as unknown as NotificationService,
      config as unknown as ConfigService,
      { enabled: () => false } as any,
    );
  });

  it('sends a low-conversion alert when the lead volume is sufficient', async () => {
    analytics.conversionRates.mockResolvedValueOnce({ overall: { leads: 20, lead_to_deal: 0.02 } });
    await scheduler.daily();
    expect(analytics.conversionRates).toHaveBeenCalledWith('7d');
    expect(notifier.notify).toHaveBeenCalledWith('alert.low_conversion', { lead_to_deal: 0.02, threshold: 0.05 });
  });

  it('does not alert for low sample volume or acceptable conversion', async () => {
    analytics.conversionRates.mockResolvedValueOnce({ overall: { leads: 19, lead_to_deal: 0 } });
    await scheduler.daily();
    analytics.conversionRates.mockResolvedValueOnce({ overall: { leads: 100, lead_to_deal: 0.1 } });
    await scheduler.daily();
    expect(notifier.notify).not.toHaveBeenCalled();
  });
});
