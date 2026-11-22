import { BadRequestException, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Query, Body, UnprocessableEntityException } from '@nestjs/common';
import { ApiBody, ApiExtraModels, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { Pool, type PoolClient } from 'pg';
import { ApiErrorEnvelope } from '../sites/site-openapi';
import { parseSurveyId, parseSurveyInput, parseSurveyPage, validateSurveyDateAgainstToday } from './survey-validation';
import { SURVEY_CREATE_BODY_SCHEMA, SURVEY_ERROR_SCHEMA, SURVEY_LIST_SCHEMA, SURVEY_PATCH_BODY_SCHEMA, SURVEY_WRITE_SCHEMA } from './survey-openapi';

interface SurveyJson {
  id: string; lon: number; lat: number; surveyed_on: string; cover_percent: number; species: string[]; note: string | null;
}

@ApiExtraModels(ApiErrorEnvelope)
@Controller()
export class SurveysController {
  constructor(private readonly pool: Pool) {}

  @Get('sites/:code/surveys')
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiResponse({ status: 200, schema: SURVEY_LIST_SCHEMA })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR', schema: SURVEY_ERROR_SCHEMA })
  @ApiResponse({ status: 404, description: 'SITE_NOT_FOUND', schema: SURVEY_ERROR_SCHEMA })
  async list(@Param('code') code: string, @Query() query: Record<string, unknown>) {
    if (Object.keys(query).some((key) => !['page', 'pageSize'].includes(key))) throw new BadRequestException();
    const page = parseSurveyPage(query.page, 1);
    const pageSize = parseSurveyPage(query.pageSize, 20, 100);
    if (page > Math.floor(Number.MAX_SAFE_INTEGER / pageSize)) throw new BadRequestException();
    const site = await this.pool.query<{ id: string }>('SELECT id FROM sites WHERE code = $1 AND deleted_at IS NULL', [code]);
    if (!site.rowCount) throw new NotFoundException({ code: 'SITE_NOT_FOUND', message: 'Site not found', details: {} });
    const count = await this.pool.query<{ total: string }>('SELECT count(*)::text AS total FROM surveys WHERE site_id = $1', [site.rows[0].id]);
    const rows = await this.pool.query<SurveyJson>(
      `SELECT s.id::text, ST_X(s.geom)::float8 AS lon, ST_Y(s.geom)::float8 AS lat,
              s.surveyed_on::text, s.cover_percent::float8 AS cover_percent, s.note,
              COALESCE(array_agg(ss.species_code ORDER BY ss.species_code) FILTER (WHERE ss.species_code IS NOT NULL), ARRAY[]::text[]) AS species
         FROM surveys s LEFT JOIN survey_species ss ON ss.survey_id = s.id
        WHERE s.site_id = $1 GROUP BY s.id ORDER BY s.surveyed_on DESC, s.id DESC
        LIMIT $2 OFFSET $3`, [site.rows[0].id, pageSize, (page - 1) * pageSize],
    );
    return { items: rows.rows, total: Number(count.rows[0].total), page };
  }

  @Post('sites/:code/surveys')
  @ApiBody({ schema: SURVEY_CREATE_BODY_SCHEMA })
  @ApiResponse({ status: 201, schema: SURVEY_WRITE_SCHEMA })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR', schema: SURVEY_ERROR_SCHEMA })
  @ApiResponse({ status: 404, description: 'SITE_NOT_FOUND', schema: SURVEY_ERROR_SCHEMA })
  @ApiResponse({ status: 422, description: 'OUTSIDE_SITE', schema: SURVEY_ERROR_SCHEMA })
  async create(@Param('code') code: string, @Body() body: unknown) {
    const input = parseSurveyInput(body, true);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const site = await client.query<{ id: string; within: boolean }>(
        `SELECT id, ST_DWithin(ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, geom::geography, 50) AS within
           FROM sites WHERE code = $1 AND deleted_at IS NULL FOR UPDATE`, [code, input.lon, input.lat],
      );
      if (!site.rowCount) throw new NotFoundException({ code: 'SITE_NOT_FOUND', message: 'Site not found', details: {} });
      if (!site.rows[0].within) throw new UnprocessableEntityException({ code: 'OUTSIDE_SITE', message: 'Survey location is more than 50 meters from Site', details: {} });
      await validateDateAndSpecies(client, input.surveyed_on!, input.species!);
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO surveys (site_id, geom, surveyed_on, cover_percent, note)
         VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), $4, $5, $6) RETURNING id::text`,
        [site.rows[0].id, input.lon, input.lat, input.surveyed_on, input.cover_percent, input.note],
      );
      await replaceSpecies(client, inserted.rows[0].id, input.species!);
      const result = await responseSurvey(client, inserted.rows[0].id, site.rows[0].id);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  @Patch('surveys/:id')
  @ApiBody({ schema: SURVEY_PATCH_BODY_SCHEMA })
  @ApiResponse({ status: 200, schema: SURVEY_WRITE_SCHEMA })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR', schema: SURVEY_ERROR_SCHEMA })
  @ApiResponse({ status: 404, description: 'SURVEY_NOT_FOUND', schema: SURVEY_ERROR_SCHEMA })
  @ApiResponse({ status: 422, description: 'OUTSIDE_SITE', schema: SURVEY_ERROR_SCHEMA })
  async update(@Param('id') rawId: string, @Body() body: unknown) {
    const id = parseSurveyId(rawId);
    const input = parseSurveyInput(body, false);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query<{ site_id: string }>('SELECT site_id FROM surveys WHERE id = $1', [id]);
      if (!found.rowCount) throw new NotFoundException({ code: 'SURVEY_NOT_FOUND', message: 'Survey not found', details: {} });
      const site = await client.query<{ id: string; within: boolean }>(
        `SELECT id, ($2::double precision IS NULL OR ST_DWithin(ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, geom::geography, 50)) AS within
           FROM sites WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [found.rows[0].site_id, input.lon ?? null, input.lat ?? null],
      );
      if (!site.rowCount) throw new NotFoundException({ code: 'SURVEY_NOT_FOUND', message: 'Survey not found', details: {} });
      const current = await client.query<{ id: string }>('SELECT id FROM surveys WHERE id = $1 AND site_id = $2 FOR UPDATE', [id, site.rows[0].id]);
      if (!current.rowCount) throw new NotFoundException({ code: 'SURVEY_NOT_FOUND', message: 'Survey not found', details: {} });
      if (!site.rows[0].within) throw new UnprocessableEntityException({ code: 'OUTSIDE_SITE', message: 'Survey location is more than 50 meters from Site', details: {} });
      if (input.surveyed_on !== undefined) await validateDateAndSpecies(client, input.surveyed_on, input.species ?? (await surveySpecies(client, id)));
      else if (input.species !== undefined) await validateSpecies(client, input.species);
      const values: unknown[] = [id];
      const updates: string[] = [];
      const add = (column: string, value: unknown, cast = '') => { values.push(value); updates.push(`${column} = $${values.length}${cast}`); };
      if (input.lon !== undefined) { values.push(input.lon, input.lat); updates.push(`geom = ST_SetSRID(ST_MakePoint($${values.length - 1}, $${values.length}), 4326)`); }
      if (input.surveyed_on !== undefined) add('surveyed_on', input.surveyed_on, '::date');
      if (input.cover_percent !== undefined) add('cover_percent', input.cover_percent, '::numeric');
      if (input.note !== undefined) add('note', input.note);
      if (updates.length) await client.query(`UPDATE surveys SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, values);
      if (input.species !== undefined) {
        await client.query('DELETE FROM survey_species WHERE survey_id = $1', [id]);
        await replaceSpecies(client, id, input.species);
      }
      const result = await responseSurvey(client, id, site.rows[0].id);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  @Delete('surveys/:id')
  @HttpCode(204)
  @ApiResponse({ status: 204, description: 'Survey deleted' })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR', schema: SURVEY_ERROR_SCHEMA })
  @ApiResponse({ status: 404, description: 'SURVEY_NOT_FOUND', schema: SURVEY_ERROR_SCHEMA })
  async remove(@Param('id') rawId: string): Promise<void> {
    const id = parseSurveyId(rawId);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query<{ site_id: string }>('SELECT site_id FROM surveys WHERE id = $1', [id]);
      if (!found.rowCount) throw new NotFoundException({ code: 'SURVEY_NOT_FOUND', message: 'Survey not found', details: {} });
      const site = await client.query('SELECT id FROM sites WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [found.rows[0].site_id]);
      if (!site.rowCount) throw new NotFoundException({ code: 'SURVEY_NOT_FOUND', message: 'Survey not found', details: {} });
      const locked = await client.query('SELECT id FROM surveys WHERE id = $1 AND site_id = $2 FOR UPDATE', [id, found.rows[0].site_id]);
      if (!locked.rowCount) throw new NotFoundException({ code: 'SURVEY_NOT_FOUND', message: 'Survey not found', details: {} });
      await client.query('DELETE FROM survey_species WHERE survey_id = $1', [id]);
      await client.query('DELETE FROM surveys WHERE id = $1', [id]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
}

async function validateDateAndSpecies(client: PoolClient, date: string, species: string[]): Promise<void> {
  const today = await client.query<{ today: string }>("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::date::text AS today");
  validateSurveyDateAgainstToday(date, today.rows[0].today);
  await validateSpecies(client, species);
}

async function validateSpecies(client: PoolClient, codes: string[]): Promise<void> {
  const found = await client.query<{ code: string }>('SELECT code FROM species WHERE code = ANY($1::text[])', [codes]);
  if (found.rowCount !== codes.length) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Unknown species code', details: {} });
}

async function surveySpecies(client: PoolClient, id: string): Promise<string[]> {
  const result = await client.query<{ species: string[] }>('SELECT COALESCE(array_agg(species_code), ARRAY[]::text[]) AS species FROM survey_species WHERE survey_id = $1', [id]);
  return result.rows[0].species;
}

async function replaceSpecies(client: PoolClient, id: string, codes: string[]): Promise<void> {
  for (const code of codes) await client.query('INSERT INTO survey_species (survey_id, species_code) VALUES ($1, $2)', [id, code]);
}

async function responseSurvey(client: PoolClient, id: string, siteId: string): Promise<SurveyJson & { siteStatus: string }> {
  const result = await client.query<SurveyJson>(
    `SELECT s.id::text, ST_X(s.geom)::float8 AS lon, ST_Y(s.geom)::float8 AS lat,
            s.surveyed_on::text, s.cover_percent::float8 AS cover_percent, s.note,
            COALESCE(array_agg(ss.species_code ORDER BY ss.species_code) FILTER (WHERE ss.species_code IS NOT NULL), ARRAY[]::text[]) AS species
       FROM surveys s LEFT JOIN survey_species ss ON ss.survey_id = s.id
      WHERE s.id = $1 GROUP BY s.id`, [id],
  );
  const status = await client.query<{ status: string }>(
    `SELECT CASE WHEN count(*) = 0 THEN 'no_data'
            WHEN avg(cover_percent) >= 75 THEN 'very_good' WHEN avg(cover_percent) >= 50 THEN 'good'
            WHEN avg(cover_percent) >= 25 THEN 'fair' ELSE 'poor' END AS status
       FROM surveys WHERE site_id = $1 AND surveyed_on = (SELECT max(surveyed_on) FROM surveys WHERE site_id = $1)`, [siteId],
  );
  return { ...result.rows[0], siteStatus: status.rows[0].status };
}
