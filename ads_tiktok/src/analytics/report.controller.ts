import { Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReportDeliveryService } from './report-delivery.service';

@ApiTags('Thống kê & báo cáo')
@Controller('api/v1/reports/deliveries')
export class ReportController {
  constructor(private readonly delivery: ReportDeliveryService) {}
  @Post()
  @ApiOperation({ summary: 'Đưa báo cáo Excel 7 ngày vào hàng đợi gửi đến REPORT_WEBHOOK_URL' })
  send() {
    return this.delivery.enqueue();
  }
  @ApiOperation({ summary: 'Xem trạng thái gửi báo cáo' })
  @Get(':id')
  async status(@Param('id') id: string) {
    const result = await this.delivery.status(id);
    if (!result) throw new NotFoundException('Không tìm thấy tác vụ gửi báo cáo');
    return result;
  }
}
