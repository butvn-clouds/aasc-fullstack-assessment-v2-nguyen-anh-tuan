import { buildQueryString } from './query-string.util';

describe('buildQueryString', () => {
  it('encodes flat key-value pairs', () => {
    expect(buildQueryString({ NAME: 'A', OPPORTUNITY: 1000 })).toBe('NAME=A&OPPORTUNITY=1000');
  });

  it('encodes nested objects with bracket notation', () => {
    expect(buildQueryString({ fields: { NAME: 'A' } })).toBe('fields%5BNAME%5D=A');
  });

  it('encodes arrays of primitives with index brackets', () => {
    expect(buildQueryString({ select: ['ID', 'NAME'] })).toBe(
      'select%5B0%5D=ID&select%5B1%5D=NAME',
    );
  });

  it('encodes Bitrix24 multi-value field shape (array of objects)', () => {
    const result = buildQueryString({
      fields: { EMAIL: [{ VALUE: 'a@b.com', VALUE_TYPE: 'WORK' }] },
    });

    expect(decodeURIComponent(result)).toBe(
      'fields[EMAIL][0][VALUE]=a@b.com&fields[EMAIL][0][VALUE_TYPE]=WORK',
    );
  });

  it('skips undefined values but keeps null/0/empty-string values', () => {
    const result = buildQueryString({ a: undefined, b: 0, c: '', d: null });

    expect(decodeURIComponent(result)).toBe('b=0&c=&d=null');
  });
});
