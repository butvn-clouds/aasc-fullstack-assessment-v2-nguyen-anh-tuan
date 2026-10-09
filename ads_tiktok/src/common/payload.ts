/** Các trường được dùng sau khi payload đi qua bước kiểm tra đầu vào. */
export interface LeadPayload extends Record<string, unknown> {
  event_id?: string;
  ttclid?: string;
  mock?: boolean;
  campaign?: Record<string, unknown>;
  form?: Record<string, unknown>;
  lead_data?: Record<string, unknown> & { ttclid?: string };
  custom_questions?: { question?: string; answer?: unknown }[];
}
