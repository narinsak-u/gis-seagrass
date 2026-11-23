import type { SiteWriteTransaction } from '../site-survey/transaction';

export interface SiteWritePort {
  create(tx: SiteWriteTransaction, site: SiteWriteInput, actorId: string): Promise<SiteFeature>;
  hasCode(tx: SiteWriteTransaction, code: string): Promise<boolean>;
  import(tx: SiteWriteTransaction, site: SiteWriteInput): Promise<boolean>;
  deriveSpatial(tx: SiteWriteTransaction, source: string): Promise<Omit<SiteSpatial, 'source'>>;
  lock(tx: SiteWriteTransaction, code: string): Promise<LockedSite | null>;
  lockForSurvey(tx: SiteWriteTransaction, code: string, lon: number, lat: number): Promise<{ id: string; within: boolean } | null>;
  lockActive(tx: SiteWriteTransaction, id: string): Promise<boolean>;
  withinDistance(tx: SiteWriteTransaction, id: string, lon: number, lat: number): Promise<boolean>;
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
