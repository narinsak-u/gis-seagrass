export const SITE_STATUS_CASE_SQL = `CASE WHEN count(*) = 0 THEN 'no_data'
                 WHEN avg(cover_percent) >= 75 THEN 'very_good' WHEN avg(cover_percent) >= 50 THEN 'good'
                 WHEN avg(cover_percent) >= 25 THEN 'fair' ELSE 'poor' END`;
