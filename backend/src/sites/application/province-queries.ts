import type { ProvinceReadRepository } from './province-read.repository';

export interface ProvinceFeature {
  type: 'Feature';
  geometry: { type: 'MultiPolygon'; coordinates: number[][][][] };
  properties: {
    code: string;
    name_th: string;
  };
}

export interface ProvinceFeatureCollection {
  type: 'FeatureCollection';
  features: ProvinceFeature[];
}

export class ProvinceQueries {
  constructor(private readonly provinces: ProvinceReadRepository) {}

  async withinBbox(bbox: [number, number, number, number]): Promise<ProvinceFeatureCollection> {
    const rows = await this.provinces.withinBbox(bbox);
    return {
      type: 'FeatureCollection',
      features: rows.map((row) => ({
        type: 'Feature',
        geometry: row.geometry,
        properties: {
          code: row.code,
          name_th: row.name_th,
        },
      })),
    };
  }
}
