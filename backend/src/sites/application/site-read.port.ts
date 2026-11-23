export interface SiteReadFilters {
  province?: string;
  search?: string;
  page: number;
  pageSize: number;
}

export interface SiteReadRow extends Record<string, unknown> {
  id: string;
  code: string;
  name: string;
  province_code: string;
  area_rai: string;
  version: number;
}

export interface SiteDetailRow extends SiteReadRow {
  geometry: { type: 'MultiPolygon'; coordinates: number[][][][] };
}

export interface SiteReadPort {
  list(filters: SiteReadFilters): Promise<{ rows: SiteReadRow[]; total: number }>;
  detail(code: string): Promise<SiteDetailRow | null>;
  withinBbox(bbox: [number, number, number, number], province?: string): Promise<SiteDetailRow[]>;
}

export const SITE_READ_PORT = Symbol('SITE_READ_PORT');
