import type { SiteStatus } from './site-status.rules';
export type { SiteStatus } from './site-status.rules';

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
