import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    const req = host.switchToHttp().getRequest();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = exception instanceof HttpException ? exception.getResponse() : { message: 'Lỗi máy chủ nội bộ' };
    const path = String(req.url ?? '')
      .split(/[?#]/, 1)[0]
      .replace(/[\r\n]/g, '');
    if (status >= 500) this.logger.error(`${req.method} ${path}`, (exception as Error)?.stack);
    res.status(status).json({
      statusCode: status,
      path,
      timestamp: new Date().toISOString(),
      ...(typeof body === 'string' ? { message: body } : (body as object)),
    });
  }
}
