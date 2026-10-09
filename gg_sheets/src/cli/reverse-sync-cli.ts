import { NestFactory } from '@nestjs/core';
import { CliAppModule } from './sync-cli.module';
import { TwoWaySyncService } from '../sync/two-way-sync.service';
import { publicError } from '../common/public-error';

async function main() {
  const app = await NestFactory.createApplicationContext(CliAppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const result = await app.get(TwoWaySyncService).run();
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.errors > 0 ? 1 : 0;
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Đồng bộ ngược qua dòng lệnh thất bại:', publicError(err));
  process.exitCode = 1;
});
