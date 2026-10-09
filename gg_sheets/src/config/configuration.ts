export interface AppConfig {
  google: {
    sheetId: string;
    worksheetName: string;
    authMode: 'service_account' | 'oauth' | 'oauth2';
    serviceAccountKeyPath?: string;
    serviceAccountKeyJson?: string;
    oauthClientId?: string;
    oauthClientSecret?: string;
    oauthRefreshToken?: string;
    detectFormats?: boolean;
  };
  sync: { maxRetries: number; retryBaseDelayMs: number };
  server: { port: number };
}

export default function configuration(): AppConfig {
  const env = process.env;
  const integer = (key: string, fallback: number, min: number, max: number): number => {
    const value = Number(env[key] ?? fallback);
    if (!Number.isInteger(value) || value < min || value > max)
      throw new Error(`${key} phải là số nguyên từ ${min} đến ${max}`);
    return value;
  };
  if (!['forward', 'reverse', 'both'].includes(env.SYNC_DIRECTION ?? 'forward'))
    throw new Error('SYNC_DIRECTION phải là forward, reverse hoặc both');
  if (!['bitrix_wins', 'sheet_wins'].includes(env.CONFLICT_RESOLUTION_STRATEGY ?? 'bitrix_wins'))
    throw new Error('CONFLICT_RESOLUTION_STRATEGY phải là bitrix_wins hoặc sheet_wins');
  integer('SYNC_BITRIX_CONCURRENCY', 2, 1, 50);
  const authMode = env.GOOGLE_AUTH_MODE ?? 'service_account';
  if (!['service_account', 'oauth', 'oauth2'].includes(authMode)) {
    throw new Error('GOOGLE_AUTH_MODE phải là service_account, oauth hoặc oauth2');
  }
  return {
    google: {
      sheetId: env.GOOGLE_SHEET_ID ?? '',
      worksheetName: env.GOOGLE_SHEET_WORKSHEET_NAME ?? env.GOOGLE_WORKSHEET_NAME ?? 'Leads',
      authMode: authMode as AppConfig['google']['authMode'],
      serviceAccountKeyPath: env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
      serviceAccountKeyJson: env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON,
      oauthClientId: env.GOOGLE_OAUTH_CLIENT_ID,
      oauthClientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      oauthRefreshToken: env.GOOGLE_OAUTH_REFRESH_TOKEN,
      detectFormats: env.GOOGLE_DETECT_FORMATS !== 'false',
    },
    sync: {
      maxRetries: integer('SYNC_MAX_RETRIES', 4, 0, 10),
      retryBaseDelayMs: integer('SYNC_RETRY_BASE_DELAY_MS', 500, 0, 60000),
    },
    server: { port: integer('PORT', 3000, 1, 65535) },
  };
}
