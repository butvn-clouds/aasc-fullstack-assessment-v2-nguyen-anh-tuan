import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ApiBody, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Queue } from 'bullmq';
import { JOB_OPTIONS, QUEUES } from '../common/constants';
import { LeadImportService } from './lead-import.service';
import { LeadsService } from './leads.service';

@ApiTags('Khách hàng & giao dịch')
@Controller('api/v1/leads')
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    @InjectQueue(QUEUES.BITRIX_SYNC) private readonly syncQueue: Queue,
    private readonly importer: LeadImportService,
  ) {}

  @ApiOperation({ summary: 'Danh sách khách hàng tiềm năng' })
  @ApiQuery({
    name: 'page',
    required: false,
    schema: { type: 'integer', minimum: 1 },
    description: 'Trang bắt đầu từ 1.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100 },
    description: 'Số bản ghi mỗi trang, mặc định 10 và tối đa 100.',
  })
  @ApiQuery({ name: 'source', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'campaign_id', required: false, type: String })
  @ApiOkResponse({
    description: 'Danh sách lead theo trang và tổng số bản ghi khớp bộ lọc.',
    schema: {
      type: 'object',
      required: ['items', 'total', 'page', 'limit'],
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              externalId: { type: 'string' },
              source: { type: 'string' },
              name: { type: 'string' },
              email: { type: 'string', nullable: true },
              phone: { type: 'string', nullable: true },
              city: { type: 'string', nullable: true },
              campaignId: { type: 'string', nullable: true },
              adId: { type: 'string', nullable: true },
              formId: { type: 'string', nullable: true },
              extraContacts: {
                type: 'object',
                properties: {
                  emails: { type: 'array', items: { type: 'string' } },
                  phones: { type: 'array', items: { type: 'string' } },
                },
              },
              score: { type: 'integer' },
              rawData: { type: 'object', nullable: true, additionalProperties: true },
              bitrix24Id: { type: 'integer', nullable: true },
              status: { type: 'string' },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' },
            },
          },
        },
        total: { type: 'integer', minimum: 0 },
        page: { type: 'integer', minimum: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
    },
  })
  @Get()
  list(@Query() q: { page?: number; limit?: number; source?: string; status?: string; campaign_id?: string }) {
    return this.leads.list(q);
  }

  @ApiOperation({ summary: 'Chi tiết và lịch sử khách hàng tiềm năng' })
  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return { ...(await this.leads.getOrFail(id)), timeline: await this.leads.getTimeline(id) };
  }

  @ApiOperation({ summary: 'Chuyển khách hàng tiềm năng thành giao dịch' })
  @Post(':id/convert-to-deal')
  @HttpCode(202)
  async convert(@Param('id', ParseUUIDPipe) id: string) {
    await this.leads.getOrFail(id);
    await this.syncQueue.add('sync', { leadId: id, forceDeal: true }, { ...JOB_OPTIONS, jobId: `convert-${id}` });
    return { queued: true };
  }

  @ApiOperation({ summary: 'Nhập dữ liệu khách hàng theo lô' })
  @ApiBody({
    schema: { type: 'array', maxItems: 1000, items: { type: 'object', additionalProperties: true } },
    description: 'Mảng sự kiện TikTok. Kết quả từng dòng: queued, duplicate, invalid, failed hoặc pending_recovery.',
  })
  @Post('import')
  @HttpCode(202)
  importBatch(@Body() payloads: unknown) {
    return this.importer.importBatch(payloads);
  }
}
