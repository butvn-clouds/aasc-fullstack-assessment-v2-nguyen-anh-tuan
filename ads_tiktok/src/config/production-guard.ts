const PLACEHOLDERS = new Set(['', 'change-me', 'changeme', 'your-inbound-webhook']);
const MIN_SECRET_LENGTH = 16;

function weakSecret(value: string | undefined): boolean {
  const v = (value ?? '').trim();
  return PLACEHOLDERS.has(v.toLowerCase()) || v.length < MIN_SECRET_LENGTH;
}

export function productionConfigErrors(env: NodeJS.ProcessEnv): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const errors: string[] = [];
  if (weakSecret(env.ADMIN_API_KEY)) {
    errors.push(
      `ADMIN_API_KEY bắt buộc, tối thiểu ${MIN_SECRET_LENGTH} ký tự (nếu để trống, /api và /mock sẽ mở công khai)`,
    );
  }
  if (weakSecret(env.TIKTOK_WEBHOOK_SECRET)) {
    errors.push(`TIKTOK_WEBHOOK_SECRET bắt buộc, tối thiểu ${MIN_SECRET_LENGTH} ký tự và khác "change-me"`);
  }
  if (env.TIKTOK_EVENTS_MOCK?.toLowerCase() !== 'true') {
    try {
      const url = new URL(env.TIKTOK_EVENTS_API_URL ?? '');
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
    } catch {
      errors.push('TIKTOK_EVENTS_API_URL bắt buộc là URL HTTPS hợp lệ khi không bật TIKTOK_EVENTS_MOCK');
    }
    if (weakSecret(env.TIKTOK_ACCESS_TOKEN))
      errors.push('TIKTOK_ACCESS_TOKEN bắt buộc và không được dùng giá trị mặc định/yếu');
  }
  if (env.BITRIX24_MOCK?.toLowerCase() !== 'true') {
    if (
      !/^https:\/\/.+\/$/.test(env.BITRIX24_WEBHOOK_URL ?? '') ||
      /your-portal|your-inbound-webhook/.test(env.BITRIX24_WEBHOOK_URL ?? '')
    ) {
      errors.push('BITRIX24_WEBHOOK_URL phải là URL REST HTTPS thật của Bitrix24 và kết thúc bằng dấu /');
    }
    if (weakSecret(env.BITRIX24_APP_TOKEN)) {
      errors.push('BITRIX24_APP_TOKEN (application_token của outbound webhook) bắt buộc, khác "change-me"');
    }
  }
  return errors;
}

export function assertProductionConfig(env: NodeJS.ProcessEnv = process.env): void {
  const errors = productionConfigErrors(env);
  if (errors.length) {
    throw new Error(`Cấu hình production không an toàn:\n- ${errors.join('\n- ')}`);
  }
}
