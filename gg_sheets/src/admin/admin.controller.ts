import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ADMIN_PAGE } from '../sync/admin-page';

@ApiExcludeController()
@Controller('admin')
export class AdminController {
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  page() {
    return ADMIN_PAGE;
  }
}
