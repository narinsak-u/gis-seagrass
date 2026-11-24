import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE_DATABASE, type DatabaseProvider } from '../../platform/database';
import type { LatestSurveySummary, SurveyStatusRepository } from '../application/survey-status.repository';

interface SurveyReadRow extends Record<string, unknown> {
  site_id: string;
  cover_percentages: number[];
}

@Injectable()
export class DrizzleSurveyStatusRepository implements SurveyStatusRepository {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: DatabaseProvider['db']) {}

  async latestCoverPercentages(siteIds: readonly string[]): Promise<ReadonlyMap<string, readonly number[]>> {
    if (siteIds.length === 0) return new Map();
    const result = await this.db.execute<SurveyReadRow>(sql`
      WITH latest_dates AS (
        SELECT site_id, max(surveyed_on) AS surveyed_on
          FROM surveys
         WHERE site_id IN (${sql.join(siteIds.map((siteId) => sql`${siteId}::bigint`), sql`, `)})
         GROUP BY site_id
      )
      SELECT surveys.site_id::text AS site_id, array_agg(surveys.cover_percent::float8) AS cover_percentages
        FROM surveys
        JOIN latest_dates USING (site_id, surveyed_on)
       GROUP BY surveys.site_id
    `);
    return new Map(result.rows.map((row) => [row.site_id, row.cover_percentages]));
  }

  async latestSurvey(siteId: string): Promise<LatestSurveySummary | null> {
    const result = await this.db.execute<LatestSurveySummary>(sql`
      SELECT survey_ref, surveyed_on::text, cover_percent::float8 AS cover_percent
        FROM surveys
       WHERE site_id = ${siteId}::bigint
       ORDER BY surveyed_on DESC, id DESC
       LIMIT 1
    `);
    return result.rows[0] ?? null;
  }
}
