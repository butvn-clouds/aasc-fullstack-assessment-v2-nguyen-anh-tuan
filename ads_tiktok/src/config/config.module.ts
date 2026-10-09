import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Configuration } from '../database/entities';
import { DealsModule } from '../deals/deals.module';
import { ConfigController } from './config.controller';
import { ConfigStoreService } from './config-store.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Configuration]), DealsModule],
  controllers: [ConfigController],
  providers: [ConfigStoreService],
  exports: [ConfigStoreService],
})
export class ConfigStoreModule {}
