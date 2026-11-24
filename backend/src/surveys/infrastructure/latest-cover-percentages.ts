import { and, eq, inArray, max, sql } from 'drizzle-orm';
import { surveys, type DatabaseProvider } from '../../platform/database';
import type { DrizzleTransaction } from '../../site-survey-workflows/infrastructure/drizzle-transaction';

export type SurveyQueryExecutor = DatabaseProvider['db'] | DrizzleTransaction;

export async function queryLatestCoverPercentages(
  db: SurveyQueryExecutor,
  siteIds: readonly string[],
): Promise<ReadonlyMap<string, readonly number[]>> {
  if (siteIds.length === 0) return new Map();

  const latestDates = db.$with('latest_dates').as(
    db
      .select({
        siteId: surveys.siteId,
        latestSurveyedOn: max(surveys.surveyedOn).as('latest_surveyed_on'),
      })
      .from(surveys)
      .where(inArray(surveys.siteId, siteIds.map((siteId) => BigInt(siteId))))
      .groupBy(surveys.siteId),
  );

  const rows = await db
    .with(latestDates)
    .select({
      siteId: sql<string>`${surveys.siteId}::text`,
      coverPercentages: sql<number[]>`array_agg(${surveys.coverPercent}::float8)`,
    })
    .from(surveys)
    .innerJoin(
      latestDates,
      and(
        eq(surveys.siteId, latestDates.siteId),
        eq(surveys.surveyedOn, latestDates.latestSurveyedOn),
      ),
    )
    .groupBy(surveys.siteId);

  return new Map(rows.map((row) => [row.siteId, row.coverPercentages]));
}
