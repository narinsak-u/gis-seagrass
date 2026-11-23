import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { SiteWriteTransaction } from '../../site-survey/transaction';
import type { SurveyInput } from '../survey-validation';
import type { SurveyWritePort, SurveyWriteResponse } from '../survey-write.port';

@Injectable()
export class DrizzleSurveyWriteStore implements SurveyWritePort {
  async existsRef(tx: SiteWriteTransaction, ref: string): Promise<boolean> {
    const result = await tx.execute(sql`SELECT 1 FROM surveys WHERE survey_ref = ${ref}`);
    return result.rows.length > 0;
  }

  async import(tx: SiteWriteTransaction, siteId: string, ref: string, input: SurveyInput): Promise<boolean> {
    const inserted = await tx.execute<{ id: string }>(sql`
      INSERT INTO surveys (site_id, survey_ref, geom, surveyed_on, cover_percent)
      VALUES (${siteId}::bigint, ${ref}, ST_SetSRID(ST_MakePoint(${input.lon}, ${input.lat}), 4326),
        ${input.surveyed_on}::date, ${input.cover_percent})
      ON CONFLICT (survey_ref) WHERE survey_ref IS NOT NULL DO NOTHING
      RETURNING id::text
    `);
    if (!inserted.rows.length) return false;
    for (const code of new Set(input.species!)) {
      await tx.execute(sql`INSERT INTO survey_species (survey_id, species_code) VALUES (${inserted.rows[0].id}::bigint, ${code})`);
    }
    return true;
  }


  async siteId(tx: SiteWriteTransaction, id: string): Promise<string | null> {
    const result = await tx.execute<{ site_id: string }>(sql`SELECT site_id::text FROM surveys WHERE id = ${id}::bigint`);
    return result.rows[0]?.site_id ?? null;
  }

  async lock(tx: SiteWriteTransaction, id: string, siteId: string): Promise<boolean> {
    const result = await tx.execute(sql`SELECT id FROM surveys WHERE id = ${id}::bigint AND site_id = ${siteId}::bigint FOR UPDATE`);
    return result.rows.length > 0;
  }

  async today(tx: SiteWriteTransaction): Promise<string> {
    const result = await tx.execute<{ today: string }>(sql`SELECT (clock_timestamp() AT TIME ZONE 'Asia/Bangkok')::date::text AS today`);
    return result.rows[0].today;
  }

  async hasSpecies(tx: SiteWriteTransaction, codes: string[]): Promise<boolean> {
    if (codes.length === 0) return true;
    const result = await tx.execute<{ code: string }>(sql`SELECT code FROM species WHERE code IN (${sql.join(codes.map((code) => sql`${code}`), sql`, `)})`);
    return result.rows.length === codes.length;
  }

  async species(tx: SiteWriteTransaction, id: string): Promise<string[]> {
    const result = await tx.execute<{ species: string[] }>(sql`
      SELECT COALESCE(array_agg(species_code), ARRAY[]::text[]) AS species FROM survey_species WHERE survey_id = ${id}::bigint
    `);
    return result.rows[0].species;
  }

  async create(tx: SiteWriteTransaction, siteId: string, input: SurveyInput, actorId: string): Promise<SurveyWriteResponse> {
    const inserted = await tx.execute<{ id: string }>(sql`
      INSERT INTO surveys (site_id, geom, surveyed_on, cover_percent, note, created_by, updated_by)
      VALUES (${siteId}::bigint, ST_SetSRID(ST_MakePoint(${input.lon!}, ${input.lat!}), 4326), ${input.surveyed_on}::date,
        ${input.cover_percent}::numeric, ${input.note}, ${actorId}::uuid, ${actorId}::uuid)
      RETURNING id::text
    `);
    await this.replaceSpecies(tx, inserted.rows[0].id, input.species!);
    return this.response(tx, inserted.rows[0].id);
  }

  async update(tx: SiteWriteTransaction, id: string, siteId: string, input: SurveyInput, actorId: string): Promise<SurveyWriteResponse> {
    const updates: SQL[] = [];
    if (input.lon !== undefined) updates.push(sql`geom = ST_SetSRID(ST_MakePoint(${input.lon}, ${input.lat}), 4326)`);
    if (input.surveyed_on !== undefined) updates.push(sql`surveyed_on = ${input.surveyed_on}::date`);
    if (input.cover_percent !== undefined) updates.push(sql`cover_percent = ${input.cover_percent}::numeric`);
    if (input.note !== undefined) updates.push(sql`note = ${input.note}`);
    updates.push(sql`updated_by = ${actorId}::uuid`);
    await tx.execute(sql`
      UPDATE surveys SET ${sql.join(updates, sql`, `)}, updated_at = CURRENT_TIMESTAMP
       WHERE id = ${id}::bigint AND site_id = ${siteId}::bigint
    `);
    if (input.species !== undefined) await this.replaceSpecies(tx, id, input.species);
    return this.response(tx, id);
  }


  async remove(tx: SiteWriteTransaction, id: string): Promise<void> {
    await tx.execute(sql`DELETE FROM survey_species WHERE survey_id = ${id}::bigint`);
    await tx.execute(sql`DELETE FROM surveys WHERE id = ${id}::bigint`);
  }

  private async replaceSpecies(tx: SiteWriteTransaction, id: string, codes: string[]): Promise<void> {
    await tx.execute(sql`DELETE FROM survey_species WHERE survey_id = ${id}::bigint`);
    for (const code of codes) {
      await tx.execute(sql`INSERT INTO survey_species (survey_id, species_code) VALUES (${id}::bigint, ${code})`);
    }
  }

  private async response(tx: SiteWriteTransaction, id: string): Promise<SurveyWriteResponse> {
    const result = await tx.execute<Omit<SurveyWriteResponse, 'siteStatus'> & { site_id: string }>(sql`
      SELECT s.id::text, s.site_id::text, ST_X(s.geom)::float8 AS lon, ST_Y(s.geom)::float8 AS lat,
             s.surveyed_on::text, s.cover_percent::float8 AS cover_percent, s.note,
             COALESCE(array_agg(ss.species_code ORDER BY ss.species_code) FILTER (WHERE ss.species_code IS NOT NULL), ARRAY[]::text[]) AS species
        FROM surveys s LEFT JOIN survey_species ss ON ss.survey_id = s.id
       WHERE s.id = ${id}::bigint
       GROUP BY s.id
    `);
    const row = result.rows[0];
    const status = await tx.execute<{ status: string }>(sql`
      SELECT CASE
        WHEN avg(cover_percent) >= 75 THEN 'very_good'
        WHEN avg(cover_percent) >= 50 THEN 'good'
        WHEN avg(cover_percent) >= 25 THEN 'fair'
        ELSE 'poor'
      END AS status
      FROM surveys WHERE site_id = ${row.site_id}::bigint
        AND surveyed_on = (SELECT max(surveyed_on) FROM surveys WHERE site_id = ${row.site_id}::bigint)
    `);
    const { site_id: _siteId, ...survey } = row;
    return { ...survey, siteStatus: status.rows[0].status };
  }
}
