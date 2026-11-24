import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import { DRIZZLE_DATABASE, sites, surveySpecies, surveys, type DatabaseProvider } from '../../platform/database';
import type { SurveyListRepository, SurveyPage } from '../application/survey-list.repository';

@Injectable()
export class DrizzleSurveyListRepository implements SurveyListRepository {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: DatabaseProvider['db']) {}

  async listBySiteCode(code: string, page: number, pageSize: number): Promise<SurveyPage | null> {
    const [site] = await this.db
      .select({ id: sites.id })
      .from(sites)
      .where(and(eq(sites.code, code), isNull(sites.deletedAt)))
      .limit(1);
    if (!site) return null;

    const [countRow] = await this.db
      .select({ total: count() })
      .from(surveys)
      .where(eq(surveys.siteId, site.id));
    const items = await this.db
      .select({
        id: sql<string>`${surveys.id}::text`,
        lon: sql<number>`ST_X(${surveys.geom})::float8`,
        lat: sql<number>`ST_Y(${surveys.geom})::float8`,
        surveyed_on: surveys.surveyedOn,
        cover_percent: sql<number>`${surveys.coverPercent}::float8`,
        note: surveys.note,
        created_by: surveys.createdBy,
        species: sql<string[]>`COALESCE(array_agg(${surveySpecies.speciesCode} ORDER BY ${surveySpecies.speciesCode}) FILTER (WHERE ${surveySpecies.speciesCode} IS NOT NULL), ARRAY[]::text[])`,
      })
      .from(surveys)
      .leftJoin(surveySpecies, eq(surveySpecies.surveyId, surveys.id))
      .where(eq(surveys.siteId, site.id))
      .groupBy(surveys.id)
      .orderBy(desc(surveys.surveyedOn), desc(surveys.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return { items, total: Number(countRow.total), page };
  }
}
