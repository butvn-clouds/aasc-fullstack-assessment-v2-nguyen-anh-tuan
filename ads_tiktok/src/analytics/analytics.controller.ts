import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Res,
  Sse,
  MessageEvent,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AnalyticsService } from './analytics.service';
import { XLSX_TYPE } from './xlsx';
import { Observable, from, exhaustMap, map, distinctUntilChanged } from 'rxjs';
import { SessionService } from '../auth/session.service';
import { AnalyticsStreamService } from './analytics-stream.service';
import { ReportExportService } from './report-export.service';
import { validateDateRange } from './date-range';
import { createReadStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

@ApiTags('Thống kê & báo cáo')
@Controller('api/v1')
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly sessions: SessionService,
    private readonly live: AnalyticsStreamService,
    private readonly exports: ReportExportService,
  ) {}

  @ApiOperation({
    summary: 'Theo dõi số liệu thay đổi theo thời gian thực',
    description: 'Nhập date_range và bấm Bắt đầu bên dưới. Số liệu tự cập nhật khi thay đổi; bấm Dừng để đóng kết nối.',
  })
  @Sse('analytics/stream')
  @ApiQuery({ name: 'date_range', required: false, example: '30d' })
  stream(@Query('date_range') range = '30d', @Req() req: { sessionToken?: string } = {}): Observable<MessageEvent> {
    validateDateRange(range);
    return this.live.watch(range).pipe(
      exhaustMap((snapshot) =>
        from(
          (async () => {
            if (req.sessionToken && !(await this.sessions.validate(req.sessionToken)))
              throw new UnauthorizedException('Phiên đăng nhập đã hết hạn hoặc bị thu hồi');
            return snapshot;
          })(),
        ),
      ),
      distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
      map((data) => ({ type: 'statistics', data })),
    );
  }

  @ApiOperation({ summary: 'Xem tỷ lệ chuyển đổi' })
  @Get('analytics/conversion-rates')
  @ApiQuery({ name: 'date_range', required: false, example: '30d' })
  conversion(@Query('date_range') range?: string) {
    validateDateRange(range);
    return this.analytics.conversionRates(range);
  }

  @ApiOperation({ summary: 'Xem hiệu quả chiến dịch' })
  @Get('analytics/campaign-performance')
  @ApiQuery({ name: 'date_range', required: false, example: '30d' })
  performance(@Query('date_range') range?: string) {
    validateDateRange(range);
    return this.analytics.campaignPerformance(range);
  }

  @ApiOperation({ summary: 'Tải báo cáo CSV, JSON hoặc Excel' })
  @Get('reports/export')
  @ApiQuery({ name: 'format', enum: ['csv', 'json', 'xlsx'] })
  @ApiQuery({ name: 'date_range', required: false, example: '30d' })
  async export(@Query('format') format = 'csv', @Query('date_range') range = '30d', @Res() res: Response) {
    if (!['csv', 'json', 'xlsx'].includes(format)) throw new BadRequestException('format phải là csv, json hoặc xlsx');
    validateDateRange(range);
    if (format === 'xlsx') {
      const abort = new AbortController();
      const onClose = () => {
        if (!res.writableFinished) abort.abort();
      };
      res.once('close', onClose);
      let report: Awaited<ReturnType<ReportExportService['createXlsx']>> | undefined;
      try {
        report = await this.exports.createXlsx(range, abort.signal);
        res.setHeader('Content-Type', XLSX_TYPE);
        res.setHeader('Content-Disposition', `attachment; filename="leads-${range}.xlsx"`);
        await pipeline(createReadStream(report.path), res, { signal: abort.signal });
      } catch (error: unknown) {
        // Kết nối đã đóng thì không cố gửi thêm phản hồi JSON từ bộ lọc lỗi.
        if (abort.signal.aborted || res.destroyed) return;
        throw error;
      } finally {
        res.removeListener('close', onClose);
        await report?.dispose();
      }
      return;
    }
    const abort = new AbortController();
    const onClose = () => {
      if (!res.writableFinished) abort.abort();
    };
    res.once('close', onClose);
    const iterator = this.exports.streamText(range, format as 'csv' | 'json', abort.signal);
    try {
      // Đọc phần đầu trước khi gửi header để lỗi truy vấn đầu tiên vẫn trả HTTP lỗi đúng.
      const first = await iterator.next();
      res.setHeader('Content-Type', format === 'json' ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8');
      if (format === 'csv') res.setHeader('Content-Disposition', `attachment; filename="leads-${range}.csv"`);
      const body = Readable.from(
        (async function* () {
          if (!first.done) yield first.value;
          yield* iterator;
        })(),
        { objectMode: false },
      );
      await pipeline(body, res, { signal: abort.signal });
    } catch (error: unknown) {
      if (abort.signal.aborted || res.destroyed) return;
      throw error;
    } finally {
      res.removeListener('close', onClose);
      await iterator.return(undefined);
    }
  }
}
