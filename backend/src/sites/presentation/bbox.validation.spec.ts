import { expect, test } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { parseBbox, requireValidBbox } from './bbox.validation';
test('shared bbox validation accepts valid WGS84 envelopes and rejects invalid values', () => {
  expect(parseBbox('98.5,7.2,100.4,9.8')).toStrictEqual([98.5, 7.2, 100.4, 9.8]);
  expect(requireValidBbox('-180,-90,180,90')).toStrictEqual([-180, -90, 180, 90]);

  const invalidCases: unknown[] = [
    undefined,
    '',
    '100,10,102',
    '100,10,,11',
    '100,10,NaN,11',
    '100,10,Infinity,11',
    '-181,10,102,11',
    '100,10,181,11',
    '100,-91,102,11',
    '100,10,102,91',
    '100,10,100,11',
    '100,10,101,10',
    '101,10,100,11',
    '100,11,101,10',
    ['100,10,101,11'],
  ];

  for (const invalid of invalidCases) {
    expect(parseBbox(invalid), `expected parseBbox(${JSON.stringify(invalid)}) to fail`).toBe(undefined);
    let error: unknown;
    try {
      requireValidBbox(invalid);
    } catch (cause) {
      error = cause;
    }
    if (!(error instanceof BadRequestException)) {
      throw new Error(`expected requireValidBbox(${JSON.stringify(invalid)}) to throw INVALID_BBOX`);
    }
    expect((error.getResponse() as Record<string, unknown>).code).toBe('INVALID_BBOX');
  }
});
