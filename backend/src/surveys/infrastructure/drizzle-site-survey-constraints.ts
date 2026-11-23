import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { SiteWriteTransaction } from '../../sites/site-write.port';
import type { SiteSurveyConstraintsPort } from '../site-survey-constraints.port';

@Injectable()
export class DrizzleSiteSurveyConstraints implements SiteSurveyConstraintsPort {
  async hasSurveys(tx: SiteWriteTransaction, siteId: string): Promise<boolean> {
    const result = await tx.execute<{ exists: boolean }>(sql`
      SELECT EXISTS (SELECT 1 FROM surveys WHERE site_id = ${siteId}::bigint) AS exists
    `);
    return result.rows[0].exists;
  }

  async hasSurveysOutside(tx: SiteWriteTransaction, siteId: string, geometry: string): Promise<boolean> {
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
