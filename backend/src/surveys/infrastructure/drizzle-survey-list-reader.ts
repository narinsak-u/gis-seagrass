import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, isNull, sql } from 'drizzle-orm';
import { sites, surveys } from '../../database/schema';
import { DRIZZLE_DATABASE, type DatabaseProvider } from '../../database/provider';
import type { SurveyListReaderPort, SurveyPage } from '../survey-list-reader.port';

interface SurveyListRow extends Record<string, unknown> {
  id: string;
  lon: number;
  lat: number;
  surveyed_on: string;
  cover_percent: number;
  species: string[];
  note: string | null;
  created_by: string | null;
}

@Injectable()
export class DrizzleSurveyListReader implements SurveyListReaderPort {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: DatabaseProvider['db']) {}

  async listBySiteCode(code: string, page: number, pageSize: number): Promise<SurveyPage | null> {
    const [site] = await this.db.select({ id: sites.id })
      .from(sites)
      .where(and(eq(sites.code, code), isNull(sites.deletedAt)))
      .limit(1);
    if (!site) return null;

    const [countRow] = await this.db.select({ total: count() })
      .from(surveys)
      .where(eq(surveys.siteId, site.id));
    const rows = await this.db.execute<SurveyListRow>(sql`
      SELECT s.id::text, ST_X(s.geom)::float8 AS lon, ST_Y(s.geom)::float8 AS lat,
             s.surveyed_on::text, s.cover_percent::float8 AS cover_percent, s.note, s.created_by::text,
             COALESCE(array_agg(ss.species_code ORDER BY ss.species_code) FILTER (WHERE ss.species_code IS NOT NULL), ARRAY[]::text[]) AS species
        FROM surveys s LEFT JOIN survey_species ss ON ss.survey_id = s.id
       WHERE s.site_id = ${site.id}::bigint GROUP BY s.id ORDER BY s.surveyed_on DESC, s.id DESC
       LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `);
    return { items: rows.rows, total: Number(countRow.total), page };
  }
}
