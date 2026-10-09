import { Controller, Delete, Get, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SessionService } from './session.service';
import { Throttle } from '@nestjs/throttler';

@ApiTags('Hệ thống')
@Controller('api/v1/auth/sessions')
export class SessionController {
  constructor(private readonly sessions: SessionService) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Tạo phiên đăng nhập quản trị trong Redis bằng X-API-Key' })
  @ApiHeader({ name: 'X-API-Key', required: true })
  create(@Headers('x-api-key') key?: string) {
    return this.sessions.create(key);
  }

  private token(authorization?: string) {
    const token = /^Bearer ([a-f0-9]{64})$/i.exec(authorization ?? '')?.[1];
    if (!token) throw new UnauthorizedException('Cần cung cấp mã phiên đăng nhập Bearer');
    return token;
  }

  @ApiOperation({ summary: 'Xem phiên đăng nhập hiện tại' })
  @Get('current')
  async current(@Headers('authorization') authorization?: string) {
    const session = await this.sessions.validate(this.token(authorization));
    if (!session) throw new UnauthorizedException('Phiên đăng nhập đã hết hạn hoặc bị thu hồi');
    return session;
  }

  @ApiOperation({ summary: 'Đăng xuất và thu hồi phiên đăng nhập' })
  @Delete('current')
  async logout(@Headers('authorization') authorization?: string) {
    await this.sessions.revoke(this.token(authorization));
    return { revoked: true };
  }
}
