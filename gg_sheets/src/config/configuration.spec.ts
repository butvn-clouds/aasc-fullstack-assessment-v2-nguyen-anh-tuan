import configuration from './configuration';

describe('configuration validation', () => {
  const original = process.env;
  beforeEach(() => {
    process.env = {};
  });
  afterEach(() => {
    process.env = original;
  });
  it('loads defaults without exposing credentials in errors', () => {
    expect(configuration()).toMatchObject({
      sync: { maxRetries: 4, retryBaseDelayMs: 500 },
      server: { port: 3000 },
    });
  });
  it.each([
    ['PORT', '0'],
    ['PORT', '65536'],
    ['PORT', 'abc'],
    ['SYNC_MAX_RETRIES', '-1'],
    ['SYNC_MAX_RETRIES', '11'],
    ['SYNC_RETRY_BASE_DELAY_MS', 'Infinity'],
    ['SYNC_BITRIX_CONCURRENCY', '0'],
    ['SYNC_DIRECTION', 'typo'],
    ['CONFLICT_RESOLUTION_STRATEGY', 'last_write_wins'],
    ['GOOGLE_AUTH_MODE', 'bad'],
  ])('rejects invalid %s', (key, value) => {
    process.env[key] = value;
    expect(() => configuration()).toThrow(key);
  });
  it('accepts valid OAuth and worksheet aliases', () => {
    process.env.GOOGLE_AUTH_MODE = 'oauth2';
    process.env.GOOGLE_WORKSHEET_NAME = 'Customers';
    process.env.SYNC_DIRECTION = 'both';
    process.env.CONFLICT_RESOLUTION_STRATEGY = 'sheet_wins';
    expect(configuration().google).toMatchObject({
      authMode: 'oauth2',
      worksheetName: 'Customers',
    });
  });
});
