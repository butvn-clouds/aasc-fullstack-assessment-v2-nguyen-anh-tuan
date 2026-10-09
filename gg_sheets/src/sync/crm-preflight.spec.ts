import { CrmPreflightService } from './crm-preflight.service';
import { SyncService } from './sync.service';
import { TwoWaySyncService } from './two-way-sync.service';
import { ConnectionCheckService } from './connection-check.service';

describe('Lead-only CRM preflight', () => {
  it.each([1, '1'])('accepts Classic CRM mode %s', async (mode) => {
    const call = jest.fn().mockResolvedValue(mode);
    await new CrmPreflightService({ call } as any).assertClassic();
    expect(call).toHaveBeenCalledWith('crm.settings.mode.get');
  });
  it.each([2, '2', null, 0, {}, []])('fails closed for unsupported mode %s', async (mode) => {
    await expect(
      new CrmPreflightService({ call: async () => mode } as any).assertClassic(),
    ).rejects.toThrow(/CRM_/);
  });
  it('checks again when the portal changes mode', async () => {
    const call = jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    const service = new CrmPreflightService({ call } as any);
    await service.assertClassic();
    await expect(service.assertClassic()).rejects.toThrow('CRM_SIMPLE_MODE');
  });
  it('blocks forward and reverse before touching Sheet', async () => {
    const sheets = { readRows: jest.fn() };
    const preflight = new CrmPreflightService({ call: async () => 2 } as any);
    const forward = new SyncService(
      sheets as any,
      {} as any,
      {} as any,
      {} as any,
      undefined,
      preflight,
    );
    const reverse = new TwoWaySyncService(
      sheets as any,
      {} as any,
      {} as any,
      {} as any,
      undefined,
      preflight,
    );
    await expect(forward.run()).rejects.toThrow('CRM_SIMPLE_MODE');
    await expect(reverse.run()).rejects.toThrow('CRM_SIMPLE_MODE');
    expect(sheets.readRows).not.toHaveBeenCalled();
  });
  it('shows actionable mode errors in Admin connection check', async () => {
    const call = jest.fn().mockResolvedValue(2);
    const bitrix = { call } as any;
    const check = new ConnectionCheckService(
      { get: (_key, fallback) => fallback } as any,
      { checkConnection: async () => {} } as any,
      bitrix,
      new CrmPreflightService(bitrix),
    );
    const result = await check.check();
    expect(result.google.ok).toBe(true);
    expect(result.bitrix).toMatchObject({
      ok: false,
      code: 'CRM_SIMPLE_MODE',
      message: expect.stringContaining('Classic CRM'),
    });
    expect(call).toHaveBeenCalledTimes(1);
  });
});
