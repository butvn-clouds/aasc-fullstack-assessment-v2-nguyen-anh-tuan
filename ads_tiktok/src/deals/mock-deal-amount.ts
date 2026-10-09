import { isRecord } from '../common/object';
import { createHash } from 'crypto';

/** Ước tính ổn định trong ngân sách giả lập; không suy đoán số tiền cho khách hàng thật. */
export function mockDealAmount(payload: unknown): number | null {
  if (!isRecord(payload) || payload.mock !== true || !Array.isArray(payload.custom_questions)) return null;
  const answer = payload.custom_questions.filter(isRecord).find((q) => q.question === 'Budget range')?.answer;
  if (typeof answer !== 'string') return null;
  const match = /^(\d+)-(\d+) triệu VND$/.exec(answer);
  if (!match) return null;
  const min = Number(match[1]) * 10;
  const max = Number(match[2]) * 10;
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min <= 0 || max < min || max > 100000) return null;
  const seed = String(
    payload.event_id ?? (isRecord(payload.lead_data) ? payload.lead_data.ttclid : undefined) ?? 'demo',
  );
  const hash = createHash('sha256').update(seed).digest().readUInt32BE(0);
  return (min + (hash % (max - min + 1))) * 100000;
}
