import { isRecord } from './object';
import { BadRequestException } from '@nestjs/common';
export type Json = Record<string, unknown>;

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export function parseBitrixField(key: unknown): string[] {
  if (
    typeof key !== 'string' ||
    key.length > 256 ||
    !/^[A-Za-z_][A-Za-z0-9_]*(?:\[(?:[A-Za-z_][A-Za-z0-9_]*|\d+)\])*$/.test(key)
  )
    throw new BadRequestException('Đường dẫn trường Bitrix24 không hợp lệ');
  const parts = key.match(/[^\[\]]+/g)!;
  if (parts.some((part) => FORBIDDEN_KEYS.has(part)))
    throw new BadRequestException('Mapping không được chứa __proto__, prototype hoặc constructor');
  return parts;
}

export function getPath(obj: Json, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (Array.isArray(acc) && /^\d+$/.test(key)) return acc[Number(key)];
    return isRecord(acc) && Object.prototype.hasOwnProperty.call(acc, key) ? acc[key] : undefined;
  }, obj);
}

/** Ghi giá trị vào key dạng Bitrix24: "EMAIL[0][VALUE]" -> { EMAIL: [{ VALUE }] } */
export function setBitrixField(target: Json, key: string, value: unknown): void {
  const [name, ...tokens] = parseBitrixField(key);
  if (tokens.length === 0) {
    target[name] = value;
    return;
  }
  const isIndex = (t: string) => /^\d+$/.test(t);
  const owns = (obj: object, key: string | number) => Object.prototype.hasOwnProperty.call(obj, key);
  if (!owns(target, name) || target[name] == null) target[name] = isIndex(tokens[0]) ? [] : {};
  if (!isRecord(target[name]) && !Array.isArray(target[name]))
    throw new BadRequestException('Các đường dẫn mapping xung đột');
  let cursor = target[name] as Record<string, unknown>;
  tokens.forEach((tok, i) => {
    const k: string | number = isIndex(tok) ? Number(tok) : tok;
    if (i === tokens.length - 1) {
      cursor[k] = value;
    } else {
      if (!owns(cursor, k) || cursor[k] == null) cursor[k] = isIndex(tokens[i + 1]) ? [] : {};
      if (!isRecord(cursor[k]) && !Array.isArray(cursor[k]))
        throw new BadRequestException('Các đường dẫn mapping xung đột');
      cursor = cursor[k] as Record<string, unknown>;
    }
  });
}

export function buildBitrixFields(mapping: Record<string, string>, payload: Json): Json {
  const fields: Json = {};
  for (const [src, dest] of Object.entries(mapping ?? {})) {
    parseBitrixField(dest);
    const value = getPath(payload, src);
    if (value === undefined || value === null || value === '') continue;
    setBitrixField(fields, dest, value);
  }
  for (const multi of ['EMAIL', 'PHONE']) {
    if (Array.isArray(fields[multi])) {
      fields[multi] = fields[multi].filter(isRecord).map((v: Json) => ({ VALUE_TYPE: 'WORK', ...v }));
    }
  }
  return fields;
}

export function appendExtraContacts(
  fields: Json,
  extra: { emails?: string[]; phones?: string[] } | null | undefined,
): void {
  for (const [key, values] of [
    ['EMAIL', extra?.emails],
    ['PHONE', extra?.phones],
  ] as const) {
    if (!values?.length) continue;
    const list: Json[] = Array.isArray(fields[key]) ? fields[key].filter(isRecord) : [];
    for (const value of values) {
      if (!list.some((item) => item?.VALUE === value)) list.push({ VALUE: value, VALUE_TYPE: 'WORK' });
    }
    fields[key] = list;
  }
}
