import { Global, Module } from '@nestjs/common';
import { MappingConfigService } from './mapping-config.service';

@Global()
@Module({
  providers: [MappingConfigService],
  exports: [MappingConfigService],
})
export class MappingConfigModule {}
