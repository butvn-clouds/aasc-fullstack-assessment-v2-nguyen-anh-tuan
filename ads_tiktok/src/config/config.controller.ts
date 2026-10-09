import { BadRequestException, Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOperation, ApiBody, ApiTags } from '@nestjs/swagger';
import { isRecord } from '../common/object';
import { parseBitrixField } from '../common/bitrix-mapper';
import { CONFIG_KEYS } from '../common/constants';
import { RuleEngineService } from '../deals/rule-engine.service';
import { ConfigStoreService } from './config-store.service';

@ApiTags('Cấu hình')
@Controller('api/v1/config')
export class ConfigController {
  constructor(
    private readonly store: ConfigStoreService,
    private readonly rules: RuleEngineService,
  ) {}

  @ApiOperation({ summary: 'Xem ánh xạ trường dữ liệu' })
  @Get('mappings')
  getMappings() {
    return this.store.get(CONFIG_KEYS.MAPPING);
  }

  @ApiOperation({ summary: 'Cập nhật ánh xạ trường dữ liệu' })
  @Put('mappings')
  @ApiBody({
    schema: {
      type: 'object',
      example: { field_mapping: { 'lead_data.full_name': 'NAME', 'lead_data.email': 'EMAIL[0][VALUE]' } },
    },
  })
  async putMappings(@Body() body: { field_mapping?: Record<string, string> } | Record<string, string>) {
    const mapping =
      body && typeof body === 'object' && !Array.isArray(body) && 'field_mapping' in body ? body.field_mapping : body;
    if (
      !mapping ||
      typeof mapping !== 'object' ||
      Array.isArray(mapping) ||
      Object.values(mapping).some((v) => typeof v !== 'string')
    ) {
      throw new BadRequestException('Ánh xạ phải có dạng { "source.path": "BITRIX_FIELD" }');
    }
    Object.values(mapping).forEach(parseBitrixField);
    await this.store.set(CONFIG_KEYS.MAPPING, mapping);
    return mapping;
  }

  @ApiOperation({ summary: 'Xem quy tắc tạo giao dịch' })
  @Get('rules')
  getRules() {
    return this.store.get(CONFIG_KEYS.RULES);
  }

  @ApiOperation({ summary: 'Cập nhật quy tắc tạo giao dịch' })
  @Put('rules')
  @ApiBody({
    schema: {
      type: 'object',
      example: {
        deal_rules: [
          {
            condition: "campaign.campaign_name CONTAINS 'sale'",
            action: 'create_deal',
            pipeline_id: '0',
            stage_id: 'NEW',
            probability: 30,
            probability_mode: 'fixed',
            assign_to: { strategy: 'round_robin', users: [1, 2] },
          },
        ],
      },
    },
  })
  async putRules(@Body() body: unknown) {
    const rules = Array.isArray(body) ? body : isRecord(body) ? body.deal_rules : undefined;
    if (!Array.isArray(rules)) throw new BadRequestException('deal_rules phải là một mảng');
    rules.forEach((r) => this.rules.validateRule(r));
    await this.store.set(CONFIG_KEYS.RULES, rules);
    return rules;
  }

  @ApiOperation({ summary: 'Xem chi phí chiến dịch' })
  @Get('costs')
  getCosts() {
    return this.store.get(CONFIG_KEYS.COSTS);
  }

  @ApiOperation({
    summary: 'Cập nhật chi phí chiến dịch',
    description:
      'Nhập tổng chi phí VND tương ứng với nhóm lead và khoảng thời gian báo cáo đang đánh giá. Không tự lấy chi phí từ TikTok hoặc quy đổi ngoại tệ.',
  })
  @Put('costs')
  @ApiBody({
    schema: { type: 'object', additionalProperties: { type: 'number' }, example: { '1234567890123456789': 5000000 } },
  })
  async putCosts(@Body() body: Record<string, number>) {
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.values(body).some((v) => !Number.isFinite(v) || v < 0)
    )
      throw new BadRequestException('Chi phí theo mã chiến dịch phải là các số không âm');
    await this.store.set(CONFIG_KEYS.COSTS, body);
    return body;
  }
}
