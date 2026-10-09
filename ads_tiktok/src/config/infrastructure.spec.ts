import { databaseOptions, infrastructureErrors, validateInfrastructure } from './infrastructure';

describe('Cấu hình hạ tầng', () => {
  it('giữ mặc định local và giới hạn pool', () => {
    expect(databaseOptions({})).toMatchObject({
      port: 5432,
      password: 'postgres',
      synchronize: false,
      extra: { max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 },
    });
  });
  it.each(['0', '-1', '65536', 'abc', '1.5', ''])('chặn port sai %s', (value) => {
    expect(() => validateInfrastructure({ DB_PORT: value })).toThrow('DB_PORT');
    expect(infrastructureErrors({ REDIS_PORT: value })).toHaveLength(1);
  });
  it('chặn cấu hình rỗng và pool/timeout vượt giới hạn', () => {
    expect(
      infrastructureErrors({
        DB_HOST: ' ',
        REDIS_HOST: '',
        DB_POOL_MAX: '101',
        DB_CONNECTION_TIMEOUT_MS: '0',
        DB_IDLE_TIMEOUT_MS: 'abc',
      }),
    ).toHaveLength(5);
  });
  it('production không được fallback mật khẩu mặc định hoặc rỗng', () => {
    for (const value of [undefined, '', 'postgres', 'change-me']) {
      expect(() =>
        databaseOptions({ NODE_ENV: 'production', DB_PASSWORD: value, REDIS_PASSWORD: 'r'.repeat(32) }),
      ).toThrow('DB_PASSWORD');
    }
    expect(() => validateInfrastructure({ NODE_ENV: 'production', DB_PASSWORD: 'p'.repeat(32) })).toThrow(
      'REDIS_PASSWORD',
    );
  });
  it('nhận cấu hình production hợp lệ và override pool', () => {
    expect(
      databaseOptions({
        NODE_ENV: 'production',
        DB_PASSWORD: 'p'.repeat(32),
        REDIS_PASSWORD: 'r'.repeat(32),
        DB_PORT: '5433',
        DB_POOL_MAX: '15',
        DB_CONNECTION_TIMEOUT_MS: '6000',
        DB_IDLE_TIMEOUT_MS: '20000',
      }),
    ).toMatchObject({
      port: 5433,
      extra: { max: 15, connectionTimeoutMillis: 6000, idleTimeoutMillis: 20000 },
    });
  });
});
