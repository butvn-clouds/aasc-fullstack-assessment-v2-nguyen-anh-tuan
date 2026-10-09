import { ArgumentsHost, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

describe('AllExceptionsFilter', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  const run = (exception: unknown, url = '/x') => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const host = {
      switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ method: 'GET', url }) }),
    } as unknown as ArgumentsHost;
    new AllExceptionsFilter().catch(exception, host);
    return res;
  };

  it('giữ nguyên status và nội dung của HttpException', () => {
    const res = run(new NotFoundException('Không có'));
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404, path: '/x', message: 'Không có' }),
    );
  });

  it('gộp object response (ví dụ lỗi validate)', () => {
    const res = run(new BadRequestException({ message: ['a sai'], error: 'Bad Request' }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, message: ['a sai'] }));
  });

  it('che chi tiết lỗi không xác định thành 500', () => {
    const res = run(new Error('secret stack'));
    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body.message).toBe('Lỗi máy chủ nội bộ');
    expect(JSON.stringify(body)).not.toContain('secret stack');
  });

  it('xử lý HttpException trả chuỗi', () => {
    const res = run(new NotFoundException());
    expect(res.json.mock.calls[0][0].statusCode).toBe(404);
  });
  it('không ghi query nhạy cảm vào log lỗi hoặc đường dẫn phản hồi', () => {
    const res = run(new Error('Lỗi DB'), '/x?token=private&email=private@example.com');
    expect(res.json.mock.calls[0][0].path).toBe('/x');
    expect(Logger.prototype.error).toHaveBeenCalledWith('GET /x', expect.any(String));
  });
});
