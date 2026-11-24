import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { SiteWriteTransaction } from '../../site-survey-workflows';
import type { SiteSurveyConstraintRepository } from '../application/site-survey-constraint.repository';
import { asDrizzleTransaction } from '../../site-survey-workflows/infrastructure/drizzle-transaction';

@Injectable()
export class DrizzleSiteSurveyConstraintRepository implements SiteSurveyConstraintRepository {
  async hasSurveys(context: SiteWriteTransaction, siteId: string): Promise<boolean> {
    const tx = asDrizzleTransaction(context);
    const result = await tx.execute<{ exists: boolean }>(sql`
      SELECT EXISTS (SELECT 1 FROM surveys WHERE site_id = ${siteId}::bigint) AS exists
    `);
    return result.rows[0].exists;
  }

  async hasSurveysOutside(context: SiteWriteTransaction, siteId: string, geometry: string): Promise<boolean> {
    const tx = asDrizzleTransaction(context);
    const result = await tx.execute<{ exists: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1 FROM surveys
         WHERE site_id = ${siteId}::bigint
           AND NOT ST_DWithin(geom::geography, ST_SetSRID(ST_GeomFromGeoJSON(${geometry}), 4326)::geography, 50)
      ) AS exists
    `);
    return result.rows[0].exists;
  }
}
