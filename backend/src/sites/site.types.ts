import type { SiteStatus } from '../domain/site-status';
export type { SiteStatus } from '../domain/site-status';

export interface SiteSummary {
  code: string;
  name: string;
  province_code: string;
  area_rai: number;
  version: number;
}


export interface PublicSiteSummary extends SiteSummary {
  siteStatus: SiteStatus;
}
