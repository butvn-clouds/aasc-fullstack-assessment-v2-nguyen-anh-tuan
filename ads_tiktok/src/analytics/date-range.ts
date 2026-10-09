import { BadRequestException } from '@nestjs/common';

export function validateDateRange(range: unknown = '30d'): void {
  if (typeof range !== 'string' || !/^[1-9]\d{0,3}[dwm]$/.test(range))
    throw new BadRequestException('date_range phải có dạng 7d, 4w hoặc 1m (từ 1 đến 9999 đơn vị)');
}

export function parseDateRange(range = '30d'): Date {
  validateDateRange(range);
  const amount = Number(range.slice(0, -1));
  const unit = range.slice(-1);
  const days = amount * (unit === 'w' ? 7 : unit === 'm' ? 30 : 1);
  return new Date(Date.now() - days * 86400000);
}
