import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { AppDataSource } from './data-source';
import { Configuration } from './entities';
import { DEFAULT_MAPPING, DEFAULT_RULES } from '../config/configuration';
import { CONFIG_KEYS } from '../common/constants';

async function main() {
  const ds = await AppDataSource.initialize();
  const repo = ds.getRepository(Configuration);
  const seeds: Record<string, unknown> = {
    [CONFIG_KEYS.MAPPING]: DEFAULT_MAPPING,
    [CONFIG_KEYS.RULES]: DEFAULT_RULES,
    [CONFIG_KEYS.COSTS]: { '1234567890123456789': 5000000 },
  };
  for (const [key, value] of Object.entries(seeds)) {
    await repo.upsert({ key, value } as QueryDeepPartialEntity<Configuration>, ['key']);
  }
  console.log('Đã nạp cấu hình mẫu');
  await ds.destroy();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
