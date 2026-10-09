import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Chỉ nạp tài nguyên công khai cố định; thông tin xác thực chỉ giữ trong bộ nhớ trình duyệt.
const asset = (name: string): string => readFileSync(join(__dirname, '../admin', name), 'utf8');

export const ADMIN_PAGE = asset('index.html');
export const ADMIN_STYLES = asset('admin.css');
export const ADMIN_SCRIPT = asset('admin.js');
