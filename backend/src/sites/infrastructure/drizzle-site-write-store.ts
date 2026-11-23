import { Injectable } from '@nestjs/common';
import { ApplicationError } from '../../shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { sites } from '../../platform/database';
import type { SiteWriteTransaction } from '../../site-survey';
import type { LockedSite, SiteFeature, SitePatch, SiteSpatial, SiteWriteInput, SiteWritePort } from '../application/site-write.port';
import { asDrizzleTransaction, type DrizzleTransaction } from '../../site-survey/infrastructure/drizzle-transaction';

@Injectable()
export class DrizzleSiteWriteStore implements SiteWritePort {
  deriveSpatial(tx: SiteWriteTransaction, source: string) {
    return deriveSiteSpatial(asDrizzleTransaction(tx), source);
  }

  async create(context: SiteWriteTransaction, site: SiteWriteInput, actorId: string): Promise<SiteFeature> {
    const tx = asDrizzleTransaction(context);
    const source = JSON.stringify(site.geometry);
    const spatial = await deriveSiteSpatial(tx, source);
    const result = await tx.execute<{ version: number; geometry: SiteFeature['geometry'] }>(sql`
      INSERT INTO sites (code, name, province_code, geom, area_rai, created_by, updated_by)
      VALUES (${site.code}, ${site.name}, ${spatial.provinceCode},
        ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${source}), 4326)), ${spatial.areaRai}, ${actorId}, ${actorId})
      RETURNING version, ST_AsGeoJSON(geom, 15)::jsonb AS geometry
    `);
    return feature(site.code, site.name, spatial.provinceCode, spatial.areaRai, result.rows[0].version, result.rows[0].geometry);
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
    const inserted = await tx.execute(sql`
      INSERT INTO sites (code, name, province_code, geom, area_rai, created_by, updated_by)
      VALUES (${site.code}, ${site.name}, ${spatial.provinceCode},
        ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${source}), 4326)), ${spatial.areaRai}, NULL, NULL)
      ON CONFLICT DO NOTHING RETURNING code
    `);
    return inserted.rows.length > 0;
  }


  async lock(context: SiteWriteTransaction, code: string): Promise<LockedSite | null> {
    const tx = asDrizzleTransaction(context);
    const result = await tx.execute<{ id: string; version: number; name: string; province_code: string; area_rai: string; geometry: SiteFeature['geometry'] }>(sql`
      SELECT id::text, version, name, province_code, area_rai::text,
             ST_AsGeoJSON(geom, 15)::jsonb AS geometry
        FROM sites WHERE code = ${code} AND deleted_at IS NULL FOR UPDATE
    `);
    const row = result.rows[0];
    return row && {
      id: row.id,
      code,
      name: row.name,
      provinceCode: row.province_code,
      areaRai: row.area_rai,
      version: row.version,
      geometry: row.geometry,
    };
  }

  async lockForSurvey(context: SiteWriteTransaction, code: string, lon: number, lat: number): Promise<{ id: string; within: boolean } | null> {
    const tx = asDrizzleTransaction(context);
    const result = await tx.execute<{ id: string; within: boolean }>(sql`
      SELECT id::text, ST_DWithin(ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography, geom::geography, 50) AS within
        FROM sites WHERE code = ${code} AND deleted_at IS NULL FOR UPDATE
    `);
    return result.rows[0] ?? null;
  }

  async lockActive(context: SiteWriteTransaction, id: string): Promise<boolean> {
    const tx = asDrizzleTransaction(context);
    const result = await tx.select({ id: sites.id }).from(sites)
      .where(and(eq(sites.id, BigInt(id)), isNull(sites.deletedAt))).for('update');
    return result.length > 0;
  }

  async withinDistance(context: SiteWriteTransaction, id: string, lon: number, lat: number): Promise<boolean> {
    const tx = asDrizzleTransaction(context);
    const result = await tx.execute<{ within: boolean }>(sql`
      SELECT ST_DWithin(ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography, geom::geography, 50) AS within
        FROM sites WHERE id = ${id}::bigint AND deleted_at IS NULL
    `);
    return result.rows[0]?.within ?? false;
  }

  async update(context: SiteWriteTransaction, site: LockedSite, patch: SitePatch, actorId: string, spatial?: SiteSpatial): Promise<SiteFeature> {
    const tx = asDrizzleTransaction(context);
    const result = spatial
      ? await tx.execute<{ version: number; name: string; province_code: string; area_rai: string; geometry: SiteFeature['geometry'] }>(sql`
          UPDATE sites SET name = COALESCE(${patch.name ?? null}, name), province_code = ${spatial.provinceCode}, area_rai = ${spatial.areaRai},
            geom = ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${spatial.source}), 4326)), version = version + 1,
            updated_by = ${actorId}, updated_at = now()
          WHERE id = ${site.id}::bigint
          RETURNING version, name, province_code, area_rai::text, ST_AsGeoJSON(geom, 15)::jsonb AS geometry
        `)
      : await tx.execute<{ version: number; name: string; province_code: string; area_rai: string; geometry: SiteFeature['geometry'] }>(sql`
          UPDATE sites SET name = ${patch.name}, version = version + 1, updated_by = ${actorId}, updated_at = now()
          WHERE id = ${site.id}::bigint
          RETURNING version, name, province_code, area_rai::text, ST_AsGeoJSON(geom, 15)::jsonb AS geometry
        `);
    const row = result.rows[0];
    return feature(site.code, row.name, row.province_code, row.area_rai, row.version, row.geometry);
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

function feature(code: string, name: string, provinceCode: string, areaRai: string, version: number, geometry: SiteFeature['geometry']): SiteFeature {
  return {
    type: 'Feature',
    geometry,
    properties: { code, name, province_code: provinceCode, area_rai: Number(areaRai), version },
  };
}
