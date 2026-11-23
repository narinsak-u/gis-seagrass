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


