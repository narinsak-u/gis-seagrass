import { deriveSiteStatus } from '../../sites';
import { Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { species, surveySpecies, surveys } from '../../platform/database';
import type { SiteWriteTransaction } from '../../site-survey-workflows';
import type { SurveyInput, SurveyWriteRepository, SurveyWriteResponse } from '../application/survey-write.repository';
import { asDrizzleTransaction, type DrizzleTransaction } from '../../site-survey-workflows/infrastructure/drizzle-transaction';
import { queryLatestCoverPercentages } from './latest-cover-percentages';

@Injectable()
export class DrizzleSurveyWriteRepository implements SurveyWriteRepository {
  async existsRef(context: SiteWriteTransaction, ref: string): Promise<boolean> {
    const tx = asDrizzleTransaction(context);
    return (await tx.select({ id: surveys.id }).from(surveys).where(eq(surveys.surveyRef, ref)).limit(1)).length > 0;
  }

  async import(context: SiteWriteTransaction, siteId: string, ref: string, input: SurveyInput): Promise<boolean> {
    const tx = asDrizzleTransaction(context);
    const inserted = await tx
      .insert(surveys)
      .values({
        siteId: BigInt(siteId),
        surveyRef: ref,
        geom: sql`ST_SetSRID(ST_MakePoint(${input.lon!}, ${input.lat!}), 4326)`,
        surveyedOn: input.surveyed_on!,
        coverPercent: String(input.cover_percent!),
      })
      .onConflictDoNothing({
        target: surveys.surveyRef,
        where: sql`${surveys.surveyRef} IS NOT NULL`,
      })
      .returning({ id: surveys.id });
    if (!inserted.length) return false;
    const speciesCodes = [...new Set(input.species!)];
    if (speciesCodes.length) {
      await tx.insert(surveySpecies).values(speciesCodes.map((speciesCode) => ({
        surveyId: inserted[0].id, speciesCode,
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
    const [result] = await tx
      .select({
        today: sql<string>`(clock_timestamp() AT TIME ZONE 'Asia/Bangkok')::date::text`,
      })
      .from(sql`(VALUES (1)) AS _`);
    return result.today;
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
    const [inserted] = await tx
      .insert(surveys)
      .values({
        siteId: BigInt(siteId),
        geom: sql`ST_SetSRID(ST_MakePoint(${input.lon!}, ${input.lat!}), 4326)`,
        surveyedOn: input.surveyed_on!,
        coverPercent: String(input.cover_percent!),
        note: input.note ?? null,
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning({ id: surveys.id });
    const id = String(inserted.id);
    await this.replaceSpecies(tx, id, input.species!);
    return this.response(tx, id);
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
    const [row] = await tx
      .select({
        id: sql<string>`${surveys.id}::text`,
        site_id: sql<string>`${surveys.siteId}::text`,
        lon: sql<number>`ST_X(${surveys.geom})::float8`,
        lat: sql<number>`ST_Y(${surveys.geom})::float8`,
        surveyed_on: surveys.surveyedOn,
        cover_percent: sql<number>`${surveys.coverPercent}::float8`,
        note: surveys.note,
        species: sql<string[]>`COALESCE(array_agg(${surveySpecies.speciesCode} ORDER BY ${surveySpecies.speciesCode}) FILTER (WHERE ${surveySpecies.speciesCode} IS NOT NULL), ARRAY[]::text[])`,
      })
      .from(surveys)
      .leftJoin(surveySpecies, eq(surveySpecies.surveyId, surveys.id))
      .where(eq(surveys.id, BigInt(id)))
      .groupBy(surveys.id);
    const coverPercentages = await queryLatestCoverPercentages(tx, [row.site_id]);
    const { site_id: _siteId, ...survey } = row;
    return { ...survey, siteStatus: deriveSiteStatus(coverPercentages.get(row.site_id) ?? []) };
  }
}
