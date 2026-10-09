import { randomInt, randomUUID } from 'crypto';
import { TikTokLeadPayloadDto } from './tiktok-payload.dto';

const pick = <T>(items: readonly T[]): T => items[randomInt(items.length)];
type MockLeadQuality = 'weak' | 'interested' | 'qualified' | 'priority';

export function pickMockLeadQuality(roll = randomInt(100)): MockLeadQuality {
  if (roll < 30) return 'weak';
  if (roll < 60) return 'interested';
  if (roll < 85) return 'qualified';
  return 'priority';
}
const profiles = [
  {
    id: '1234567890123456789',
    title: 'Smartphone Sale',
    slug: 'smartphone_sale',
    form: 'Tư vấn điện thoại',
    interests: ['điện thoại', 'chụp ảnh', 'gaming', 'công nghệ'],
    budgets: ['5-10 triệu VND', '10-15 triệu VND', '15-25 triệu VND'],
    ads: ['Camera chụp đêm sắc nét', 'Pin cả ngày, sạc nhanh', 'Chơi game mượt mà'],
  },
  {
    id: '1234567890123456790',
    title: 'Laptop Sale',
    slug: 'laptop_sale',
    form: 'Tư vấn laptop',
    interests: ['laptop', 'lập trình', 'thiết kế đồ họa', 'làm việc văn phòng'],
    budgets: ['10-15 triệu VND', '15-25 triệu VND', '25-40 triệu VND'],
    ads: ['Laptop mỏng nhẹ cho công việc', 'Hiệu năng cho nhà sáng tạo', 'Góc học tập và làm việc'],
  },
  {
    id: '1234567890123456791',
    title: 'Smart Home Discovery',
    slug: 'smart_home_discovery',
    form: 'Tư vấn nhà thông minh',
    interests: ['nhà thông minh', 'an ninh', 'tiết kiệm điện', 'tự động hóa'],
    budgets: ['3-5 triệu VND', '5-10 triệu VND', '10-20 triệu VND'],
    ads: ['Điều khiển ngôi nhà từ điện thoại', 'An tâm khi vắng nhà', 'Chiếu sáng thông minh'],
  },
] as const;

export class MockLeadFactory {
  private phoneSequence = randomInt(10000000);

  create(
    campaignName?: string,
    quality: MockLeadQuality = pickMockLeadQuality(),
  ): TikTokLeadPayloadDto & { mock: boolean } {
    const id = randomUUID();
    const profile = pick(profiles);
    const ad = randomInt(profile.ads.length);
    const name = `${pick(['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Vũ', 'Đặng', 'Đỗ', 'Bùi', 'Phan'])} ${pick([
      'Minh Anh',
      'Hoàng Nam',
      'Thu Hà',
      'Gia Huy',
      'Ngọc Linh',
      'Quang Minh',
      'Thanh Tâm',
      'Đức Anh',
      'Phương Thảo',
      'Bảo Ngọc',
      'Tuấn Kiệt',
      'Khánh Linh',
      'Hải Đăng',
      'Thùy Dương',
      'Trung Hiếu',
      'Mai Chi',
      'Anh Tuấn',
      'Hồng Nhung',
      'Minh Khang',
      'Hà My',
    ])}`;
    const emailName = name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/gi, 'd')
      .toLowerCase()
      .replace(/\s+/g, '.');
    const year = new Date().getFullYear();
    // Hoán vị tạo số điện thoại đa dạng, không trùng trong 10 triệu lần gọi.
    const phone = `+8432${String((this.phoneSequence++ * 7919) % 10000000).padStart(7, '0')}`;
    return {
      event: 'lead.generate',
      event_id: `evt_${id}`,
      timestamp: Math.floor(Date.now() / 1000),
      mock: true,
      advertiser_id: '7123456789',
      campaign: {
        campaign_id: profile.id,
        campaign_name: campaignName ?? `[DEMO] ${profile.title} ${year}`,
        ad_id: String(9876543210987654300n + BigInt(profiles.indexOf(profile) * 10 + ad)),
        ad_name: profile.ads[ad],
      },
      form: { form_id: `form_${profile.slug}`, form_name: profile.form },
      lead_data: {
        full_name: `[DEMO] ${name}`,
        email: `${emailName}.${id.replace(/-/g, '')}@example.com`,
        ...(quality !== 'weak' ? { phone } : {}),
        ...(quality === 'qualified' || quality === 'priority'
          ? {
              city: pick([
                'Hà Nội',
                'TP. Hồ Chí Minh',
                'Đà Nẵng',
                'Hải Phòng',
                'Cần Thơ',
                'Huế',
                'Bắc Ninh',
                'Nha Trang',
              ]),
            }
          : {}),
        interests: [profile.interests[0], pick(profile.interests.slice(1))],
        utm_source: 'tiktok',
        utm_campaign: `${profile.slug}_${year}`,
        ttclid: `TT-${id.replace(/-/g, '')}`,
      },
      custom_questions: [
        { question: 'Budget range', answer: pick(profile.budgets) },
        ...(quality === 'qualified' || quality === 'priority'
          ? [
              {
                question: 'Timeline',
                answer: pick(['Trong tuần này', 'Trong 2 tuần', 'Trong 1 tháng', 'Trong 3 tháng']),
              },
            ]
          : []),
        ...(quality === 'priority'
          ? [{ question: 'Preferred contact time', answer: pick(['Buổi sáng', 'Buổi chiều', 'Sau 18 giờ']) }]
          : []),
      ],
    };
  }
}
