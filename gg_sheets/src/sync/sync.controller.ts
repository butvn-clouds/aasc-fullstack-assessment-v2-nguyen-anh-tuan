import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  UseGuards,
  Optional,
} from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { SyncService } from './sync.service';
import { TwoWaySyncService } from './two-way-sync.service';
import { MappingConfig, MappingConfigService } from '../config/mapping-config.service';
import { ADMIN_STYLES, ADMIN_SCRIPT } from './admin-page';
import { withSyncLock } from './sync-lock.util';
import { SyncHistoryService } from './sync-history.service';
import { ConnectionCheckService } from './connection-check.service';

@ApiTags('sync')
@ApiSecurity('api-key')
@Controller('api/v1/sync')
export class SyncController {
  constructor(
    private readonly syncService: SyncService,
    private readonly twoWaySyncService: TwoWaySyncService,
    private readonly mappingConfig: MappingConfigService,
    @Optional() private readonly history?: SyncHistoryService,
    @Optional() private readonly connections?: ConnectionCheckService,
  ) {}

  @Post('admin/connections/check')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  checkConnections() {
    return this.connections!.check();
  }

  @Get('admin/history')
  @UseGuards(ApiKeyGuard)
  @Header('Cache-Control', 'no-store')
  historyList() {
    return this.history?.list() ?? { runs: [], persistenceError: false };
  }

  @Post('run')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  run() {
    return this.syncService.run();
  }

  @Post('reverse-run')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  reverseRun() {
    return this.twoWaySyncService.run();
  }

  @Get('admin/config')
  @UseGuards(ApiKeyGuard)
  config() {
    return this.mappingConfig.get();
  }

  @Put('admin/config')
  @UseGuards(ApiKeyGuard)
  updateConfig(@Body() config: MappingConfig) {
    return withSyncLock(async () => this.mappingConfig.update(config));
  }

  /** Kiểm tra quyền gọi API quản trị; không kiểm tra thông tin xác thực Google/Bitrix. */
  @Get('admin')
  @UseGuards(ApiKeyGuard)
  @Header('Cache-Control', 'no-store')
  adminConnection() {
    return { authenticated: true };
  }

  @Get('admin/assets/admin.css')
  @Header('Content-Type', 'text/css; charset=utf-8')
  @Header('Cache-Control', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  adminStyles() {
    return ADMIN_STYLES;
  }

  @Get('admin/assets/admin.js')
  @Header('Content-Type', 'application/javascript; charset=utf-8')
  @Header('Cache-Control', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  adminScript() {
    return ADMIN_SCRIPT;
  }
}
