import type { DatabaseProvider } from '../database/provider';

export type SiteWriteTransaction = Parameters<Parameters<DatabaseProvider['db']['transaction']>[0]>[0];

export interface SiteWritePort {
  create(tx: SiteWriteTransaction, site: SiteWriteInput, actorId: string): Promise<SiteFeature>;
  deriveSpatial(tx: SiteWriteTransaction, source: string): Promise<Omit<SiteSpatial, 'source'>>;
  lock(tx: SiteWriteTransaction, code: string): Promise<LockedSite | null>;
  update(tx: SiteWriteTransaction, site: LockedSite, patch: SitePatch, actorId: string, spatial?: SiteSpatial): Promise<SiteFeature>;
  retire(tx: SiteWriteTransaction, site: LockedSite, actorId: string): Promise<void>;
}

export interface SiteWriteInput {
  code: string;
  name: string;
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown };
}

export interface SitePatch {
  version: number;
  name?: string;
  geometry?: SiteWriteInput['geometry'];
}

export interface SiteSpatial {
  source: string;
  provinceCode: string;
  areaRai: string;
}

export interface LockedSite {
  id: string;
  code: string;
  name: string;
  provinceCode: string;
  areaRai: string;
  version: number;
  geometry: SiteFeature['geometry'];
}

export interface SiteFeature {
  type: 'Feature';
  geometry: { type: 'MultiPolygon'; coordinates: number[][][][] };
  properties: { code: string; name: string; province_code: string; area_rai: number; version: number };
}

export const SITE_WRITE_PORT = Symbol('SITE_WRITE_PORT');
