import { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { LoggingInterceptor } from './logging.interceptor';

describe('LoggingInterceptor', () => {
  it('trả nguyên kết quả và ghi log method, URL, thời gian', async () => {
    const interceptor = new LoggingInterceptor();
    const log = jest.spyOn((interceptor as any).logger, 'log').mockImplementation(() => undefined);
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({ method: 'POST', originalUrl: '/api/v1/leads?token=secret&email=private@example.com' }),
      }),
    } as unknown as ExecutionContext;
    const handler: CallHandler = { handle: () => of({ ok: true }) };

    await expect(lastValueFrom(interceptor.intercept(ctx, handler))).resolves.toEqual({ ok: true });
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^POST \/api\/v1\/leads \d+ms$/));
  });
});
