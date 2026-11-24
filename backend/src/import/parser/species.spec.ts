import { expect, test } from 'vitest';
import { parseSpeciesArray, parseSpeciesRecord } from './species';

test('species parser requires array and nonempty required fields', () => {
  expect(() => parseSpeciesArray('{')).toThrow(/JSON/);
  expect(() => parseSpeciesArray('{"code":"AA"}')).toThrow(/array/i);
  expect(() => parseSpeciesRecord({ code: ' ', name_th: 'ชื่อ', name_sci: 'Species' })).toThrow(/INVALID_PROPERTIES/);
  expect(() => parseSpeciesRecord({ code: 'AA', name_th: '', name_sci: 'Species' })).toThrow(/INVALID_PROPERTIES/);
  expect(() => parseSpeciesRecord({ code: 'AA', name_th: 'ชื่อ', name_sci: '  ' })).toThrow(/INVALID_PROPERTIES/);
  expect(parseSpeciesRecord({ code: 'AA', name_th: 'ชื่อ', name_sci: 'Species alba' })).toStrictEqual({
    code: 'AA', nameTh: 'ชื่อ', nameSci: 'Species alba',
  });
});
