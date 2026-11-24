import { Injectable } from '@nestjs/common';
import { ApplicationError, isRecord } from '../../shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { sites } from '../../platform/database';
import type { SiteWriteTransaction } from '../../site-survey-workflows';
import type { LockedSite, SiteFeature, SitePatch, SiteSpatial, SiteWriteInput, SiteWriteRepository } from '../application/site-write.repository';
import { asDrizzleTransaction, type DrizzleTransaction } from '../../site-survey-workflows/infrastructure/drizzle-transaction';

@Injectable()
export class DrizzleSiteWriteRepository implements SiteWriteRepository {
  deriveSpatial(tx: SiteWriteTransaction, source: string) {
    return deriveSiteSpatial(asDrizzleTransaction(tx), source);
  }

  async create(context: SiteWriteTransaction, site: SiteWriteInput, actorId: string): Promise<SiteFeature> {
    const tx = asDrizzleTransaction(context);
    const source = JSON.stringify(site.geometry);
    const spatial = await deriveSiteSpatial(tx, source);
    try {
      const [row] = await tx
        .insert(sites)
        .values({
          code: site.code,
          name: site.name,
          provinceCode: spatial.provinceCode,
          geom: siteMultiPolygon(source),
          areaRai: spatial.areaRai,
          createdBy: actorId,
          updatedBy: actorId,
        })
        .returning({
          version: sites.version,
          geometry: siteGeometryJson(),
        });
      return feature(site.code, site.name, spatial.provinceCode, spatial.areaRai, row.version, row.geometry);
    } catch (error) {
      const databaseError = isRecord(error) && isRecord(error.cause) ? error.cause : error;
      if (isRecord(databaseError) && databaseError.code === '23505' && databaseError.constraint === 'uq_sites_code') {
        throw new ApplicationError('DUPLICATE_CODE', 'Site code already exists');
      }
      throw error;
    }
  }
  async hasCode(context: SiteWriteTransaction, code: string): Promise<boolean> {
    const tx = asDrizzleTransaction(context);
    const existing = await tx.select({ id: sites.id }).from(sites).where(eq(sites.code, code)).limit(1);
    return existing.length > 0;
  }


  async import(context: SiteWriteTransaction, site: SiteWriteInput): Promise<boolean> {
    const tx = asDrizzleTransaction(context);
    const existing = await tx.select({ id: sites.id }).from(sites).where(eq(sites.code, site.code)).limit(1);
    if (existing.length) return false;
    const source = JSON.stringify(site.geometry);
    const spatial = await deriveSiteSpatial(tx, source);
    const inserted = await tx
      .insert(sites)
      .values({
        code: site.code,
        name: site.name,
        provinceCode: spatial.provinceCode,
        geom: siteMultiPolygon(source),
        areaRai: spatial.areaRai,
        createdBy: null,
        updatedBy: null,
      })
      .onConflictDoNothing()
      .returning({ code: sites.code });
    return inserted.length > 0;
  }


  async lock(context: SiteWriteTransaction, code: string): Promise<LockedSite | null> {
    const tx = asDrizzleTransaction(context);
    const [row] = await tx
      .select({
        id: sql<string>`${sites.id}::text`,
        version: sites.version,
        name: sites.name,
        provinceCode: sites.provinceCode,
        areaRai: sites.areaRai,
        geometry: siteGeometryJson(),
      })
      .from(sites)
      .where(and(eq(sites.code, code), isNull(sites.deletedAt)))
      .for('update');
    return row ? { ...row, code } : null;
  }

  async lockForSurvey(context: SiteWriteTransaction, code: string, lon: number, lat: number): Promise<{ id: string; within: boolean } | null> {
    const tx = asDrizzleTransaction(context);
    const [row] = await tx
      .select({
        id: sql<string>`${sites.id}::text`,
        within: withinSiteDistance(lon, lat),
      })
      .from(sites)
      .where(and(eq(sites.code, code), isNull(sites.deletedAt)))
      .for('update');
    return row ?? null;
  }

  async lockActive(context: SiteWriteTransaction, id: string): Promise<boolean> {
    const tx = asDrizzleTransaction(context);
    const result = await tx.select({ id: sites.id }).from(sites)
      .where(and(eq(sites.id, BigInt(id)), isNull(sites.deletedAt))).for('update');
    return result.length > 0;
  }

  async withinDistance(context: SiteWriteTransaction, id: string, lon: number, lat: number): Promise<boolean> {
    const tx = asDrizzleTransaction(context);
    const [row] = await tx
      .select({
        within: withinSiteDistance(lon, lat),
      })
      .from(sites)
      .where(and(eq(sites.id, BigInt(id)), isNull(sites.deletedAt)));
    return row?.within ?? false;
  }

  async update(context: SiteWriteTransaction, site: LockedSite, patch: SitePatch, actorId: string, spatial?: SiteSpatial): Promise<SiteFeature> {
    const tx = asDrizzleTransaction(context);
    const [row] = await tx
      .update(sites)
      .set({
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(spatial
          ? {
              provinceCode: spatial.provinceCode,
              areaRai: spatial.areaRai,
              geom: siteMultiPolygon(spatial.source),
            }
          : {}),
        version: sql`${sites.version} + 1`,
        updatedBy: actorId,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(sites.id, BigInt(site.id)))
      .returning({
        version: sites.version,
        name: sites.name,
        provinceCode: sites.provinceCode,
        areaRai: sites.areaRai,
        geometry: siteGeometryJson(),
      });
    return feature(site.code, row.name, row.provinceCode, row.areaRai, row.version, row.geometry);
  }

  async retire(context: SiteWriteTransaction, site: LockedSite, actorId: string): Promise<void> {
    const tx = asDrizzleTransaction(context);
    await tx.update(sites).set({
      deletedAt: sql`CURRENT_TIMESTAMP`,
      updatedBy: actorId,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }).where(eq(sites.id, BigInt(site.id)));
  }
}

// Retained as raw SQL (ADR-0003): 4-stage WITH ... MATERIALIZED PostGIS CTE validating geometry, resolving dominant province overlap, and rounding area_rai in one round trip.
async function deriveSiteSpatial(tx: DrizzleTransaction, source: string): Promise<{ provinceCode: string; areaRai: string }> {
  const result = await tx.execute<{ valid: boolean; empty: boolean; province_code: string | null; area_rai: string | null }>(sql`
    WITH candidate AS MATERIALIZED (
      SELECT ST_SetSRID(ST_GeomFromGeoJSON(${source}), 4326) AS geom
    ), validation AS MATERIALIZED (
      SELECT geom, ST_IsValid(geom) AS valid, ST_IsEmpty(geom) AS empty FROM candidate
    ), valid_candidate AS MATERIALIZED (
      SELECT geom FROM validation WHERE valid AND NOT empty
    ), coverage AS MATERIALIZED (
      SELECT p.code, ST_Area(ST_Intersection(c.geom, p.geom)::geography) AS overlap_area
        FROM valid_candidate c JOIN provinces p ON ST_Intersects(c.geom, p.geom)
    )
    SELECT validation.valid, validation.empty,
      (SELECT code FROM coverage WHERE overlap_area > 0 ORDER BY overlap_area DESC, code ASC LIMIT 1) AS province_code,
      (SELECT ROUND((ST_Area(ST_Multi(geom)::geography) / 1600)::numeric, 2)::text FROM valid_candidate) AS area_rai
    FROM validation
  `);
  const spatial = result.rows[0];
  if (!spatial.valid || spatial.empty) throw new ApplicationError('INVALID_GEOMETRY', 'Invalid geometry');
  if (spatial.province_code === null) throw new ApplicationError('OUTSIDE_COVERAGE', 'Site must overlap a Province');
  return { provinceCode: spatial.province_code, areaRai: spatial.area_rai! };
}

function siteGeometryJson() {
  return sql<SiteFeature['geometry']>`ST_AsGeoJSON(${sites.geom}, 15)::jsonb`;
}

function siteMultiPolygon(source: string) {
  return sql`ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${source}), 4326))`;
}

function withinSiteDistance(lon: number, lat: number) {
  return sql<boolean>`ST_DWithin(ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography, ${sites.geom}::geography, 50)`;
}

function feature(code: string, name: string, provinceCode: string, areaRai: string, version: number, geometry: SiteFeature['geometry']): SiteFeature {
  return {
    type: 'Feature',
    geometry,
    properties: { code, name, province_code: provinceCode, area_rai: Number(areaRai), version },
  };
}
