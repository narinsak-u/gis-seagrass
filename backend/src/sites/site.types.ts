export interface SiteSummary {
  code: string;
  name: string;
  province_code: string;
  area_rai: number;
  version: number;
}

export type SiteStatus = 'very_good' | 'good' | 'fair' | 'poor' | 'no_data';

export interface PublicSiteSummary extends SiteSummary {
  siteStatus: SiteStatus;
}
