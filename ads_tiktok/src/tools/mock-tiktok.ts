import 'dotenv/config';
import { createHmac } from 'crypto';
import axios from 'axios';
import { MockLeadFactory } from '../tiktok/mock-lead.factory';

/** Cách dùng: npm run mock:tiktok -- [địa_chỉ_webhook] [tên_chiến_dịch] */
async function main() {
  const url = process.argv[2] ?? 'http://localhost:3000/webhooks/tiktok/leads';
  const secret = process.env.TIKTOK_WEBHOOK_SECRET;
  if (!secret || secret === 'change-me') {
    throw new Error('Hãy cấu hình TIKTOK_WEBHOOK_SECRET trong tệp .env trước khi gửi dữ liệu giả lập.');
  }
  const payload = new MockLeadFactory().create(process.argv[3]);
  const body = JSON.stringify(payload);
  const t = Math.floor(Date.now() / 1000);
  const s = createHmac('sha256', secret).update(`${t}.`).update(body).digest('hex');
  const res = await axios.post(url, body, {
    headers: { 'Content-Type': 'application/json', 'TikTok-Signature': `t=${t},s=${s}` },
    validateStatus: () => true,
  });
  console.log(`TikTok giả lập trả về HTTP ${res.status}:`, res.data);
}
main();
