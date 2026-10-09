import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import type { NextFunction, Request, Response } from 'express';

/** Swagger lộ toàn bộ cấu trúc API và không có xác thực: mặc định tắt ở production. */
export function swaggerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.ENABLE_SWAGGER !== undefined) return env.ENABLE_SWAGGER === 'true';
  return env.NODE_ENV !== 'production';
}

/** Header bảo mật HTTP + tin cậy proxy tùy chọn.
 * - CSP chặt cho Admin UI (chỉ tài nguyên cùng origin; style inline được phép vì trang dùng thuộc tính style).
 * - /docs (Swagger UI) cần script inline nên chỉ nới CSP riêng đường dẫn đó, các header còn lại giữ nguyên.
 * - TRUST_PROXY (vd. "1") để req.ip là IP thật sau reverse proxy; nếu không đặt, rate limit tính theo IP kết nối. */
export function applySecurity(app: NestExpressApplication, env: NodeJS.ProcessEnv = process.env) {
  if (env.TRUST_PROXY) {
    const value = /^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY;
    app.set('trust proxy', value);
  }
  const strict = helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        // Ứng dụng có thể được truy cập qua HTTP nội bộ/localhost; không ép nâng cấp tài nguyên lên HTTPS.
        upgradeInsecureRequests: null,
      },
    },
  });
  const docs = helmet({ contentSecurityPolicy: false });
  app.use((req: Request, res: Response, next: NextFunction) =>
    (req.path.startsWith('/docs') ? docs : strict)(req, res, next),
  );
}
