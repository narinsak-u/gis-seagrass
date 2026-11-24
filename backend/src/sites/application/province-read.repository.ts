export interface ProvinceGeoJsonRow extends Record<string, unknown> {
  code: string;
  name_th: string;
  geometry: { type: 'MultiPolygon'; coordinates: number[][][][] };
}

export interface ProvinceReadRepository {
  withinBbox(bbox: [number, number, number, number]): Promise<ProvinceGeoJsonRow[]>;
}

export const PROVINCE_READ_REPOSITORY = Symbol('PROVINCE_READ_REPOSITORY');
