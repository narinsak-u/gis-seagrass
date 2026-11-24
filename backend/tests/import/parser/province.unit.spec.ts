import { expect, test } from 'vitest';
import { parseProvinceCollection, parseProvinceFeature } from '../../../src/import/parser/province';

test('province parser rejects malformed collections and invalid WGS84 coordinates', () => {
  expect(() => parseProvinceCollection('{')).toThrow(/JSON/);
  expect(() => parseProvinceCollection('{"type":"FeatureCollection"}')).toThrow(/features/i);
  expect(() => parseProvinceFeature({ type: 'Feature', properties: { code: 'AA' }, geometry: {
    type: 'Polygon', coordinates: [[[100, 10], [101, 10], [101, 11], [100, 10]]],
  } })).toThrow(/INVALID_PROPERTIES/);
  expect(() => parseProvinceFeature({ type: 'Feature', properties: { code: 'AA', name_th: 'จังหวัด' }, geometry: {
    type: 'Polygon', coordinates: [[[181, 10], [182, 10], [182, 11], [181, 10]]],
  } })).toThrow(/INVALID_COORDINATES/);
});
