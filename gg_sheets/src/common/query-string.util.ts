/** Mã hóa đối tượng lồng nhau thành chuỗi truy vấn REST của Bitrix24,
 * dùng dấu ngoặc như http_build_query của PHP, ví dụ fields[EMAIL][0][VALUE]=a@b.com.
 * Mỗi lệnh con của batch có dạng method?query.string, không phải nội dung JSON. */
export function buildQueryString(obj: Record<string, unknown>, prefix = ''): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    const paramKey = prefix ? `${prefix}[${key}]` : key;

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        const arrayKey = `${paramKey}[${index}]`;
        if (item !== null && typeof item === 'object') {
          parts.push(buildQueryString(item as Record<string, unknown>, arrayKey));
        } else {
          parts.push(`${encodeURIComponent(arrayKey)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (value !== null && typeof value === 'object') {
      parts.push(buildQueryString(value as Record<string, unknown>, paramKey));
    } else {
      parts.push(`${encodeURIComponent(paramKey)}=${encodeURIComponent(String(value))}`);
    }
  }

  return parts.filter(Boolean).join('&');
}
