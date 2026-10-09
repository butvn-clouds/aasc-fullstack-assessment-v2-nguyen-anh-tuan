const { Client } = require('pg');
const Redis = require('ioredis');

module.exports = async () => {
  const db = new Client({
    host: '127.0.0.1',
    port: 55432,
    user: 'postgres',
    password: 'test',
    database: 'integration_test',
    connectionTimeoutMillis: 3000,
  });
  let redis;
  try {
    await db.connect();
    const result = await db.query('SELECT current_database() AS name');
    if (result.rows[0].name !== 'integration_test') throw new Error('Sai database kiểm thử');
    redis = new Redis({
      host: '127.0.0.1',
      port: 56379,
      lazyConnect: true,
      connectTimeout: 3000,
      commandTimeout: 3000,
      retryStrategy: () => null,
      maxRetriesPerRequest: 0,
    });
    redis.on('error', () => {});
    await redis.connect();
    await redis.ping();
  } catch (error) {
    const reason =
      error.code === '28P01'
        ? 'PostgreSQL kiểm thử không chấp nhận mật khẩu test.'
        : `Không kết nối được hạ tầng kiểm thử (${error.code || 'connection error'}).`;
    throw new Error(
      `${reason}\nCần PostgreSQL integration_test tại 127.0.0.1:55432 và Redis tại 56379.\n` +
        'Chạy: docker compose -p ads_tiktok_test -f docker-compose.test.yml up -d --force-recreate --wait\n' +
        'Lệnh này dựng lại stack TEST riêng. Không đổi mật khẩu hoặc xóa database app chính để chạy test.',
    );
  } finally {
    redis?.disconnect();
    await db.end().catch(() => {});
  }
};
