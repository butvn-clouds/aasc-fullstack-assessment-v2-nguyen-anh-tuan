/** Tạo CSV gồm N lead giả lập để kiểm thử hiệu năng với Google Sheet và Bitrix24.
 * Nhập dữ liệu vào Sheet thử nghiệm, chạy đồng bộ rồi kiểm tra thời gian và giới hạn API.
 * Cách chạy: node scripts/generate-sample-data.js 150 > sample-data/perf-150.csv */
const count = Number(process.argv[2] ?? 100);

const headers = [
  'Tên khách hàng',
  'Email',
  'Số điện thoại',
  'Công ty',
  'Nguồn lead (UTM Source)',
  'Ngân sách dự kiến',
  'Trạng thái',
  'Người phụ trách',
  'Ghi chú',
  'Lead ID Bitrix24',
  'Trạng thái đồng bộ',
  'Thời gian đồng bộ cuối',
  'Thông báo lỗi',
  'Sync Hash',
];

const sources = ['website', 'facebook_ads', 'partner_referral', 'offline_event', 'tiktok'];
// Để trống người phụ trách để Bitrix dùng mặc định; nhập ID người dùng dạng số nếu cần chỉ định.
const owners = [''];

console.log(headers.join(','));
for (let i = 1; i <= count; i++) {
  const row = [
    `Khách hàng test ${i}`,
    `perftest${i}@example.com`,
    `09${String(10000000 + i).padStart(8, '0')}`,
    `Công ty ${i}`,
    sources[i % sources.length],
    (Math.floor(Math.random() * 50) + 5) * 1000000,
    'NEW',
    owners[i % owners.length],
    `Dữ liệu test hiệu năng #${i}`,
    '',
    '',
    '',
    '',
    '', // Để trống 5 cột trạng thái.
  ];
  console.log(row.join(','));
}
