import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { surveys } from '../../platform/database';
import type { SiteWriteTransaction } from '../../site-survey-workflows';
import type { SiteSurveyConstraintRepository } from '../application/site-survey-constraint.repository';
import { asDrizzleTransaction } from '../../site-survey-workflows/infrastructure/drizzle-transaction';

@Injectable()
export class DrizzleSiteSurveyConstraintRepository implements SiteSurveyConstraintRepository {
  async hasSurveys(context: SiteWriteTransaction, siteId: string): Promise<boolean> {
    const tx = asDrizzleTransaction(context);
    const result = await tx
      .select({ id: surveys.id })
      .from(surveys)
      .where(eq(surveys.siteId, BigInt(siteId)))
      .limit(1);
    return result.length > 0;
  }

  async hasSurveysOutside(context: SiteWriteTransaction, siteId: string, geometry: string): Promise<boolean> {
    const tx = asDrizzleTransaction(context);
    const result = await tx
      .select({ id: surveys.id })
      .from(surveys)
      .where(
        and(
          eq(surveys.siteId, BigInt(siteId)),
          sql`NOT ST_DWithin(${surveys.geom}::geography, ST_SetSRID(ST_GeomFromGeoJSON(${geometry}), 4326)::geography, 50)`,
        ),
      )
      .limit(1);
    return result.length > 0;
  }
}
