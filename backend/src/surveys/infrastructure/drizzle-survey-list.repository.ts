import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { DRIZZLE_DATABASE, sites, surveySpecies, surveys, type DatabaseProvider } from '../../platform/database';
import type { SurveyListRepository, SurveyPage } from '../application/survey-list.repository';
import { SURVEY_PROJECTION } from './survey-projection';

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
        ...SURVEY_PROJECTION,
        created_by: surveys.createdBy,
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
