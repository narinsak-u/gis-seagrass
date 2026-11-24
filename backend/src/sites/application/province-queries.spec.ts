import { expect, test } from 'vitest';
import { ProvinceQueries } from './province-queries';
import type { ProvinceGeoJsonRow, ProvinceReadRepository } from './province-read.repository';
test('ProvinceQueries maps repository rows into a GeoJSON FeatureCollection with code and name_th', async () => {
  const sampleGeometry = {
    type: 'MultiPolygon' as const,
    coordinates: [[[[99, 7], [100, 7], [100, 8], [99, 8], [99, 7]]]],
  };
  let capturedBbox: [number, number, number, number] | undefined;
  const repository: ProvinceReadRepository = {
    async withinBbox(bbox): Promise<ProvinceGeoJsonRow[]> {
      capturedBbox = bbox;
      return [
        { code: '81', name_th: 'กระบี่', geometry: sampleGeometry },
        { code: '92', name_th: 'ตรัง', geometry: sampleGeometry },
      ];
    },
  };

  const queries = new ProvinceQueries(repository);
  const collection = await queries.withinBbox([98.5, 7, 100.5, 8.5]);

  expect(capturedBbox).toStrictEqual([98.5, 7, 100.5, 8.5]);
  expect(collection).toStrictEqual({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: sampleGeometry,
        properties: { code: '81', name_th: 'กระบี่' },
      },
      {
        type: 'Feature',
        geometry: sampleGeometry,
        properties: { code: '92', name_th: 'ตรัง' },
      },
    ],
  });
});
