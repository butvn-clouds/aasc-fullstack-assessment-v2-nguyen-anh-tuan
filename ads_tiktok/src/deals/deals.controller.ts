import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { DealsService } from './deals.service';

@ApiTags('Khách hàng & giao dịch')
@Controller('api/v1/deals')
export class DealsController {
  constructor(private readonly deals: DealsService) {}

  @ApiOperation({ summary: 'Danh sách giao dịch' })
  @Get()
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'assigned_to', required: false })
  list(@Query() q: { status?: string; assigned_to?: string; page?: number; limit?: number }) {
    return this.deals.list(q);
  }
}
