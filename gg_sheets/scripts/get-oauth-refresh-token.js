/** Công cụ lấy refresh token Google OAuth 2.0 cho GOOGLE_AUTH_MODE=oauth.
 * Chạy trên máy có trình duyệt, sau đó lưu token vào .env để ứng dụng tái sử dụng.
 * Token có thể hết hiệu lực hoặc bị thu hồi.
 *
 * Chuẩn bị trên Google Cloud Console:
 * 1. Tạo OAuth client ID tại APIs & Services -> Credentials.
 * 2. Sao chép Client ID và Client Secret.
 * 3. Cấu hình URI chuyển hướng http://localhost:3999/oauth2callback cho loại ứng dụng phù hợp.
 * Cách chạy sau khi đặt biến môi trường:
 * node scripts/get-oauth-refresh-token.js */
const http = require('http');
const { OAuth2Client } = require('google-auth-library');

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const redirectUri = 'http://localhost:3999/oauth2callback';

if (!clientId || !clientSecret) {
  console.error(
    'Hãy đặt biến môi trường GOOGLE_OAUTH_CLIENT_ID và GOOGLE_OAUTH_CLIENT_SECRET trước.',
  );
  process.exit(1);
}

const client = new OAuth2Client(clientId, clientSecret, redirectUri);

const authUrl = client.generateAuthUrl({
  access_type: 'offline', // Cần quyền truy cập ngoại tuyến để nhận refresh_token.
  prompt: 'consent', // Yêu cầu xác nhận lại để nhận refresh_token dù người dùng đã cấp quyền.
  scope: ['https://www.googleapis.com/auth/spreadsheets'],
});

console.log('\nMở đường dẫn này trong trình duyệt và cấp quyền truy cập:\n');
console.log(authUrl, '\n');

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith('/oauth2callback')) return;

  const code = new URL(req.url, redirectUri).searchParams.get('code');
  res.end('Bạn có thể đóng thẻ này và quay lại cửa sổ dòng lệnh.');
  server.close();

  const { tokens } = await client.getToken(code);
  console.log('\nThêm nội dung sau vào tệp .env:\n');
  console.log(`GOOGLE_OAUTH_CLIENT_ID=${clientId}`);
  console.log(`GOOGLE_OAUTH_CLIENT_SECRET=${clientSecret}`);
  console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`);
  console.log('GOOGLE_AUTH_MODE=oauth\n');
});

server.listen(3999, () => console.log('Đang chờ bạn cấp quyền trong trình duyệt...'));
