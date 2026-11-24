import { expect, test } from 'vitest';
import { parseSiteFeature } from './site-feature';

test('Site parser requires nonempty identity and finite in-range lon/lat polygon coordinates', () => {
  const feature = (coordinates: unknown) => ({
    type: 'Feature',
    properties: { code: 'SITE-1', name: 'Site 1' },
    geometry: { type: 'Polygon', coordinates },
  });
  expect(() => parseSiteFeature({ type: 'Feature', properties: { code: 'SITE-1', name: 'Site 1' }, geometry: { type: 'LineString', coordinates: [[100, 10], [101, 11]] } })).toThrow(/INVALID_GEOMETRY/);
  expect(() => parseSiteFeature(feature([[[181, 10], [182, 10], [182, 11], [181, 10]]]))).toThrow(/INVALID_COORDINATES/);
  expect(() => parseSiteFeature({ ...feature([[[100, 10], [101, 10], [101, 11], [100, 10]]]), properties: { code: '', name: 'Site' } })).toThrow(/INVALID_PROPERTIES/);
});
