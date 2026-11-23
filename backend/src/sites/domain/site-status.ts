export type SiteStatus = 'very_good' | 'good' | 'fair' | 'poor' | 'no_data';

export function deriveSiteStatus(latestCoverPercentages: readonly number[]): SiteStatus {
  if (latestCoverPercentages.length === 0) return 'no_data';
  let total = 0;
  for (const coverPercent of latestCoverPercentages) total += coverPercent;
  const average = total / latestCoverPercentages.length;
  if (average >= 75) return 'very_good';
  if (average >= 50) return 'good';
  if (average >= 25) return 'fair';
  return 'poor';
}

export const SITE_STATUS_CASE_SQL = `CASE WHEN count(*) = 0 THEN 'no_data'
                 WHEN avg(cover_percent) >= 75 THEN 'very_good' WHEN avg(cover_percent) >= 50 THEN 'good'
                 WHEN avg(cover_percent) >= 25 THEN 'fair' ELSE 'poor' END`;

