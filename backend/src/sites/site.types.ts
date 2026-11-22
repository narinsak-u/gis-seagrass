export interface SiteSummary {
  code: string;
  name: string;
  province_code: string;
  area_rai: number;
  version: number;
}

export interface PublicSiteSummary extends SiteSummary {
  siteStatus: 'very_good' | 'good' | 'fair' | 'poor' | 'no_data';
}
