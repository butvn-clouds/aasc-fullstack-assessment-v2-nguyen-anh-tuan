/** Hàm được chuyển thành chuỗi đưa vào Swagger; không phụ thuộc mô-đun bên ngoài. */
export async function signSwaggerDemoRequest(request: {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body?: string;
}) {
  const path = new URL(request.url, window.location.href);
  if (request.method?.toUpperCase() !== 'POST' || path.pathname !== '/webhooks/tiktok/leads') return request;
  request.headers = request.headers || {};
  if (Object.keys(request.headers).some((key) => key.toLowerCase() === 'tiktok-signature' && request.headers[key]))
    return request;
  const response = await fetch(new URL('/mock/tiktok/signed-request', path.origin).href, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(request.headers['X-API-Key'] ? { 'X-API-Key': request.headers['X-API-Key'] } : {}),
      ...(request.headers.Authorization ? { Authorization: request.headers.Authorization } : {}),
    },
    body: request.body || '{}',
  });
  if (!response.ok) throw new Error('Không thể tạo yêu cầu TikTok giả lập. Bật BITRIX24_MOCK hoặc MOCK_LEADS_ENABLED.');
  const signed = await response.json();
  request.body = signed.body;
  request.headers['Content-Type'] = 'application/json';
  request.headers['TikTok-Signature'] = signed.signature;
  return request;
}
