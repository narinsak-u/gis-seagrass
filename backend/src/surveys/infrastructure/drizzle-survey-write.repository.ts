import { deriveSiteStatus } from '../../sites';
import { Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { species, surveySpecies, surveys } from '../../platform/database';
import type { SiteWriteTransaction } from '../../site-survey-workflows';
import type { SurveyInput, SurveyWriteRepository, SurveyWriteResponse } from '../application/survey-write.repository';
import { asDrizzleTransaction, type DrizzleTransaction } from '../../site-survey-workflows/infrastructure/drizzle-transaction';

@Injectable()
export class DrizzleSurveyWriteRepository implements SurveyWriteRepository {
  async existsRef(context: SiteWriteTransaction, ref: string): Promise<boolean> {
    const tx = asDrizzleTransaction(context);
    return (await tx.select({ id: surveys.id }).from(surveys).where(eq(surveys.surveyRef, ref)).limit(1)).length > 0;
  }

  async import(context: SiteWriteTransaction, siteId: string, ref: string, input: SurveyInput): Promise<boolean> {
    const tx = asDrizzleTransaction(context);
    const inserted = await tx.execute<{ id: string }>(sql`
      INSERT INTO surveys (site_id, survey_ref, geom, surveyed_on, cover_percent)
      VALUES (${siteId}::bigint, ${ref}, ST_SetSRID(ST_MakePoint(${input.lon}, ${input.lat}), 4326),
        ${input.surveyed_on}::date, ${input.cover_percent})
      ON CONFLICT (survey_ref) WHERE survey_ref IS NOT NULL DO NOTHING
      RETURNING id::text
    `);
    if (!inserted.rows.length) return false;
    const speciesCodes = [...new Set(input.species!)];
    if (speciesCodes.length) {
      await tx.insert(surveySpecies).values(speciesCodes.map((speciesCode) => ({
        surveyId: BigInt(inserted.rows[0].id), speciesCode,
      })));
    }
    return true;
  }


  async siteId(context: SiteWriteTransaction, id: string): Promise<string | null> {
    const tx = asDrizzleTransaction(context);
    const result = await tx.select({ siteId: surveys.siteId }).from(surveys).where(eq(surveys.id, BigInt(id))).limit(1);
    return result[0] ? String(result[0].siteId) : null;
  }

  async lock(context: SiteWriteTransaction, id: string, siteId: string): Promise<boolean> {
    const tx = asDrizzleTransaction(context);
    const result = await tx.select({ id: surveys.id }).from(surveys)
      .where(and(eq(surveys.id, BigInt(id)), eq(surveys.siteId, BigInt(siteId)))).for('update');
    return result.length > 0;
  }

  async today(context: SiteWriteTransaction): Promise<string> {
    const tx = asDrizzleTransaction(context);
    const result = await tx.execute<{ today: string }>(sql`
      SELECT (clock_timestamp() AT TIME ZONE 'Asia/Bangkok')::date::text AS today
    `);
    return result.rows[0].today;
  }
  async hasSpecies(context: SiteWriteTransaction, codes: string[]): Promise<boolean> {
    const tx = asDrizzleTransaction(context);
    if (codes.length === 0) return true;
    const result = await tx.select({ code: species.code }).from(species).where(inArray(species.code, codes));
    return result.length === codes.length;
  }

  async species(context: SiteWriteTransaction, id: string): Promise<string[]> {
    const tx = asDrizzleTransaction(context);
    const result = await tx.select({
      species: sql<string[]>`COALESCE(array_agg(${surveySpecies.speciesCode}), ARRAY[]::text[])`,
    }).from(surveySpecies).where(eq(surveySpecies.surveyId, BigInt(id)));
    return result[0].species;
  }

  async create(context: SiteWriteTransaction, siteId: string, input: SurveyInput, actorId: string): Promise<SurveyWriteResponse> {
    const tx = asDrizzleTransaction(context);
    const inserted = await tx.execute<{ id: string }>(sql`
      INSERT INTO surveys (site_id, geom, surveyed_on, cover_percent, note, created_by, updated_by)
      VALUES (${siteId}::bigint, ST_SetSRID(ST_MakePoint(${input.lon!}, ${input.lat!}), 4326), ${input.surveyed_on}::date,
        ${input.cover_percent}::numeric, ${input.note}, ${actorId}::uuid, ${actorId}::uuid)
      RETURNING id::text
    `);
    await this.replaceSpecies(tx, inserted.rows[0].id, input.species!);
    return this.response(tx, inserted.rows[0].id);
  }

  async update(context: SiteWriteTransaction, id: string, siteId: string, input: SurveyInput, actorId: string): Promise<SurveyWriteResponse> {
    const tx = asDrizzleTransaction(context);
    await tx.update(surveys).set({
      geom: input.lon === undefined ? undefined : sql`ST_SetSRID(ST_MakePoint(${input.lon}, ${input.lat}), 4326)`,
      surveyedOn: input.surveyed_on,
      coverPercent: input.cover_percent === undefined ? undefined : String(input.cover_percent),
      note: input.note,
      updatedBy: actorId,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }).where(and(eq(surveys.id, BigInt(id)), eq(surveys.siteId, BigInt(siteId))));
    if (input.species !== undefined) await this.replaceSpecies(tx, id, input.species);
    return this.response(tx, id);
  }


  async remove(context: SiteWriteTransaction, id: string): Promise<void> {
    const tx = asDrizzleTransaction(context);
    await tx.delete(surveySpecies).where(eq(surveySpecies.surveyId, BigInt(id)));
    await tx.delete(surveys).where(eq(surveys.id, BigInt(id)));
  }

  private async replaceSpecies(tx: DrizzleTransaction, id: string, codes: string[]): Promise<void> {
    await tx.delete(surveySpecies).where(eq(surveySpecies.surveyId, BigInt(id)));
    if (codes.length) {
      await tx.insert(surveySpecies).values([...new Set(codes)].map((speciesCode) => ({
        surveyId: BigInt(id), speciesCode,
      })));
    }
  }

  private async response(tx: DrizzleTransaction, id: string): Promise<SurveyWriteResponse> {
    const result = await tx.execute<Omit<SurveyWriteResponse, 'siteStatus'> & { site_id: string }>(sql`
      SELECT s.id::text, s.site_id::text, ST_X(s.geom)::float8 AS lon, ST_Y(s.geom)::float8 AS lat,
             s.surveyed_on::text, s.cover_percent::float8 AS cover_percent, s.note,
             COALESCE(array_agg(ss.species_code ORDER BY ss.species_code) FILTER (WHERE ss.species_code IS NOT NULL), ARRAY[]::text[]) AS species
        FROM surveys s LEFT JOIN survey_species ss ON ss.survey_id = s.id
       WHERE s.id = ${id}::bigint
       GROUP BY s.id
    `);
    const row = result.rows[0];
    const status = await tx.execute<{ cover_percentages: number[] }>(sql`
      SELECT COALESCE(array_agg(cover_percent::float8), ARRAY[]::float8[]) AS cover_percentages
      FROM surveys WHERE site_id = ${row.site_id}::bigint
        AND surveyed_on = (SELECT max(surveyed_on) FROM surveys WHERE site_id = ${row.site_id}::bigint)
    `);
    const { site_id: _siteId, ...survey } = row;
    return { ...survey, siteStatus: deriveSiteStatus(status.rows[0].cover_percentages) };
  }
}
