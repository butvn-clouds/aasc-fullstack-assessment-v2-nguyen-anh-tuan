import { BadRequestException } from '@nestjs/common';
import { plainToInstance, Type } from 'class-transformer';
import { IsInt, IsObject, IsOptional, IsString, Min, ValidateNested, validateSync } from 'class-validator';
import { isRecord } from '../common/object';

class BitrixAuthDto {
  @IsOptional() @IsString() application_token?: string;
}
class BitrixFieldsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) ID?: number;
}
class BitrixDataDto {
  @IsOptional() @IsObject() @ValidateNested() @Type(() => BitrixFieldsDto) FIELDS?: BitrixFieldsDto;
}

export class BitrixWebhookDto {
  @IsOptional() @IsString() event?: string;
  @IsOptional() @IsObject() @ValidateNested() @Type(() => BitrixAuthDto) auth?: BitrixAuthDto;
  @IsOptional() @IsObject() @ValidateNested() @Type(() => BitrixDataDto) data?: BitrixDataDto;
}

export class MockCrmDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) id?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) start?: number;
  @IsOptional() @IsObject() fields?: Record<string, unknown>;
}

/** Kiểm tra cả khi gọi trực tiếp, không phụ thuộc cấu hình ValidationPipe toàn ứng dụng. */
export function parseCrmDto<T extends object>(type: new () => T, input: unknown): T {
  if (!isRecord(input)) throw new BadRequestException('Dữ liệu CRM phải là một đối tượng');
  const dto = plainToInstance(type, input);
  const errors = validateSync(dto);
  if (errors.length)
    throw new BadRequestException(`Dữ liệu CRM không hợp lệ: ${errors.map((error) => error.property).join(', ')}`);
  return dto;
}

export interface BitrixDeal {
  ID?: number | string;
  ORIGIN_ID?: number | string;
  STAGE_ID?: string;
  PROBABILITY?: number | string | null;
  OPPORTUNITY?: number | string | null;
  [field: string]: unknown;
}
export interface BitrixResponse<T> {
  result: T;
  error?: string;
  error_description?: string;
}
export interface MockRecord {
  id: number;
  fields: Record<string, unknown>;
}
