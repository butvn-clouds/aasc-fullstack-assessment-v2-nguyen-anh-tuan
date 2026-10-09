export function infrastructureErrors(env: NodeJS.ProcessEnv): string[] {
  const errors: string[] = [];
  for (const [key, max] of [
    ['PORT', 65535],
    ['DB_PORT', 65535],
    ['REDIS_PORT', 65535],
    ['DB_POOL_MAX', 100],
    ['DB_CONNECTION_TIMEOUT_MS', 300000],
    ['DB_IDLE_TIMEOUT_MS', 300000],
  ] as const) {
    const value = env[key];
    if (value !== undefined && (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max))
      errors.push(`${key} phải là số nguyên từ 1 đến ${max}`);
  }
  for (const key of ['DB_HOST', 'DB_USER', 'DB_NAME', 'REDIS_HOST']) {
    if (env[key] !== undefined && !env[key]?.trim()) errors.push(`${key} không được để trống`);
  }
  if (env.NODE_ENV === 'production') {
    for (const key of ['DB_PASSWORD', 'REDIS_PASSWORD']) {
      const value = env[key]?.trim() ?? '';
      if (value.length < 16 || /^(postgres|password|change-me|test)$/i.test(value))
        errors.push(`${key} bắt buộc, tối thiểu 16 ký tự và không dùng mật khẩu mặc định`);
    }
  }
  return errors;
}

export function validateInfrastructure(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const errors = infrastructureErrors(env);
  if (errors.length) throw new Error(`Cấu hình hạ tầng không hợp lệ:\n- ${errors.join('\n- ')}`);
  return env;
}

export function databaseOptions(env: NodeJS.ProcessEnv) {
  validateInfrastructure(env);
  return {
    type: 'postgres' as const,
    host: env.DB_HOST ?? 'localhost',
    port: Number(env.DB_PORT ?? 5432),
    username: env.DB_USER ?? 'postgres',
    password: env.DB_PASSWORD ?? 'postgres',
    database: env.DB_NAME ?? 'leads',
    synchronize: false,
    extra: {
      max: Number(env.DB_POOL_MAX ?? 10),
      connectionTimeoutMillis: Number(env.DB_CONNECTION_TIMEOUT_MS ?? 5000),
      idleTimeoutMillis: Number(env.DB_IDLE_TIMEOUT_MS ?? 30000),
    },
  };
}
