import { Inject, Injectable } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { DRIZZLE_DATABASE, surveys, type DatabaseProvider } from '../../platform/database';
import type { LatestSurveySummary, SurveyStatusRepository } from '../application/survey-status.repository';
import { queryLatestCoverPercentages } from './latest-cover-percentages';

@Injectable()
export class DrizzleSurveyStatusRepository implements SurveyStatusRepository {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: DatabaseProvider['db']) {}

  async latestCoverPercentages(siteIds: readonly string[]): Promise<ReadonlyMap<string, readonly number[]>> {
    return queryLatestCoverPercentages(this.db, siteIds);
  }

  async latestSurvey(siteId: string): Promise<LatestSurveySummary | null> {
    const [row] = await this.db
      .select({
        survey_ref: surveys.surveyRef,
        surveyed_on: surveys.surveyedOn,
        cover_percent: sql<number>`${surveys.coverPercent}::float8`,
      })
      .from(surveys)
      .where(eq(surveys.siteId, BigInt(siteId)))
      .orderBy(desc(surveys.surveyedOn), desc(surveys.id))
      .limit(1);
    return row ?? null;
  }
}
