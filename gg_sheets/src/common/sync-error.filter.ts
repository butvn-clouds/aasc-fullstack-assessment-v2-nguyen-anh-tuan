import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { publicError } from './public-error';

@Catch()
export class SyncErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    if (error instanceof HttpException) {
      const body = error.getResponse();
      response.status(error.getStatus()).json(typeof body === 'string' ? { message: body } : body);
      return;
    }
    response.status(502).json({ statusCode: 502, ...publicError(error) });
  }
}
