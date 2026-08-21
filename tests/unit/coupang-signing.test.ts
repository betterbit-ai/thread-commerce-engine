import { describe, expect, it } from 'vitest';
import { coupangTimestamp, signCoupangRequest } from '../../src/infrastructure/coupang.js';

describe('Coupang CEA signing', () => {
  it('formats UTC timestamps exactly', () =>
    expect(coupangTimestamp(new Date('2026-08-21T06:07:08.123Z'))).toBe('260821T060708Z'));
  it('matches a deterministic signing fixture', () =>
    expect(
      signCoupangRequest({
        method: 'GET',
        path: '/v2/providers/affiliate_open_api/apis/openapi/products/search',
        query: 'keyword=mouse&limit=10',
        datetime: '260821T060708Z',
        accessKey: 'fixture-access',
        secretKey: 'fixture-secret',
      }),
    ).toBe(
      'CEA algorithm=HmacSHA256, access-key=fixture-access, signed-date=260821T060708Z, signature=025892ca47cd7094daa127535b7ad7c7e1bd2b9cb4f077e8106512b21d35a7f8',
    ));
});
