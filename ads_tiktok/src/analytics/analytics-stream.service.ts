import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { defer, exhaustMap, finalize, from, Observable, shareReplay, timer } from 'rxjs';
import { AnalyticsService } from './analytics.service';
import { validateDateRange } from './date-range';

export type StatisticsSnapshot = Awaited<ReturnType<AnalyticsService['snapshot']>>;

@Injectable()
export class AnalyticsStreamService {
  private readonly streams = new Map<string, Observable<StatisticsSnapshot>>();
  constructor(private readonly analytics: AnalyticsService) {}

  watch(range: string): Observable<StatisticsSnapshot> {
    validateDateRange(range);
    return defer(() => {
      const existing = this.streams.get(range);
      if (existing) return existing;
      if (this.streams.size >= 32)
        throw new HttpException('Đã đạt giới hạn 32 khoảng thống kê trực tiếp', HttpStatus.TOO_MANY_REQUESTS);
      const shared = timer(0, 1000).pipe(
        exhaustMap(() => from(this.analytics.snapshot(range))),
        finalize(() => {
          if (this.streams.get(range) === shared) this.streams.delete(range);
        }),
        shareReplay({ bufferSize: 1, refCount: true }),
      );
      this.streams.set(range, shared);
      return shared;
    });
  }
}
