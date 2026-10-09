import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Deal } from '../database/entities';
import { DealsController } from './deals.controller';
import { DealsService } from './deals.service';
import { RuleEngineService } from './rule-engine.service';

@Module({
  imports: [TypeOrmModule.forFeature([Deal])],
  controllers: [DealsController],
  providers: [DealsService, RuleEngineService],
  exports: [DealsService, RuleEngineService],
})
export class DealsModule {}
