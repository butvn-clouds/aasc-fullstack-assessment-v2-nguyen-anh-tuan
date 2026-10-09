import 'dotenv/config';

/** Bổ sung VND mà không thay tiền tệ cơ sở hoặc số tiền của deal đang có. */
async function main() {
  const rate = Number(process.argv[2]);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error('Cần nhập tỷ giá đã xác nhận: npx ts-node src/tools/configure-vnd.ts <VND cho 1 USD> [--apply]');
  }
  const webhook = process.env.BITRIX24_WEBHOOK_URL;
  if (!webhook?.startsWith('https://')) throw new Error('Thiếu BITRIX24_WEBHOOK_URL HTTPS');
  async function call(method: string, params: Record<string, unknown> = {}) {
    let response: Response;
    try {
      response = await fetch(`${webhook!.replace(/\/?$/, '/')}${method}.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new Error(`Không kết nối được Bitrix24 khi gọi ${method}`);
    }
    const body = (await response.json()) as { result?: unknown; error?: string };
    if (!response.ok || body.error) throw new Error(`${method} thất bại (HTTP ${response.status})`);
    return body.result;
  }
  const rows = await call('crm.currency.list');
  if (!Array.isArray(rows)) throw new Error('Danh sách tiền tệ không hợp lệ');
  if (rows.some((row) => row.CURRENCY === 'VND')) {
    console.log('VND đã có trên portal; không ghi đè tỷ giá hiện tại.');
    return;
  }
  if (!rows.some((row) => row.CURRENCY === 'USD' && row.BASE === 'Y'))
    throw new Error('Tiền tệ cơ sở không phải USD; cần kiểm tra lại tỷ giá trước khi thêm.');
  const amount = Number((1000000 / rate).toFixed(8));
  if (amount <= 0) throw new Error('Tỷ giá vượt độ chính xác cho phép');
  const fields = {
    CURRENCY: 'VND',
    BASE: 'N',
    AMOUNT_CNT: 1000000,
    AMOUNT: amount,
    SORT: 600,
    LANG: { en: { DECIMALS: 0, FORMAT_STRING: '# VND', FULL_NAME: 'Vietnamese dong', THOUSANDS_SEP: ',' } },
  };
  console.log(JSON.stringify({ vndPerUsd: rate, fields }, null, 2));
  if (!process.argv.includes('--apply')) {
    console.log('Chỉ xem trước. Thêm --apply để tạo VND trên portal.');
    return;
  }
  await call('crm.currency.add', { fields });
  const verified = await call('crm.currency.list');
  if (!Array.isArray(verified) || !verified.some((row) => row.CURRENCY === 'VND'))
    throw new Error('Chưa xác nhận được VND sau khi thêm; kiểm tra portal trước khi thử lại.');
  console.log('Đã thêm và xác nhận VND trên Bitrix24.');
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Không cấu hình được VND');
  process.exitCode = 1;
});
