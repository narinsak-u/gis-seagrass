import { Inject, Injectable } from '@nestjs/common';
import { and, sql } from 'drizzle-orm';
import { DRIZZLE_DATABASE, type DatabaseProvider } from '../../platform/database';
import type { SiteDetailRow, SiteReadFilters, SiteReadRepository, SiteReadRow } from '../application/site-read.repository';

@Injectable()
export class DrizzleSiteReadRepository implements SiteReadRepository {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: DatabaseProvider['db']) {}

  async list(filters: SiteReadFilters): Promise<{ rows: SiteReadRow[]; total: number }> {
    const conditions = [sql`s.deleted_at IS NULL`];
    if (filters.province !== undefined) conditions.push(sql`s.province_code = ${filters.province}`);
    if (filters.search !== undefined && filters.search.length > 0) {
      conditions.push(sql`(strpos(lower(s.code), lower(${filters.search})) > 0 OR strpos(lower(s.name), lower(${filters.search})) > 0)`);
    }
    const where = and(...conditions)!;
    const [count, rows] = await Promise.all([
      this.db.execute<{ total: string }>(sql`SELECT COUNT(*)::text AS total FROM sites s WHERE ${where}`),
      this.db.execute<SiteReadRow>(sql`
        SELECT s.id::text, s.code, s.name, s.province_code, s.area_rai::text, s.version
          FROM sites s
         WHERE ${where}
         ORDER BY s.code ASC
         LIMIT ${filters.pageSize} OFFSET ${(filters.page - 1) * filters.pageSize}
      `),
    ]);
    return { rows: rows.rows, total: Number(count.rows[0]?.total ?? 0) };
  }

  async detail(code: string): Promise<SiteDetailRow | null> {
    const result = await this.db.execute<SiteDetailRow>(sql`
      SELECT s.id::text, s.code, s.name, s.province_code, s.area_rai::text, s.version,
             ST_AsGeoJSON(s.geom, 15)::jsonb AS geometry
        FROM sites s
       WHERE s.code = ${code} AND s.deleted_at IS NULL
    `);
    return result.rows[0] ?? null;
  }

  async withinBbox(bbox: [number, number, number, number], province?: string): Promise<SiteDetailRow[]> {
    const [minLon, minLat, maxLon, maxLat] = bbox;
    const result = await this.db.execute<SiteDetailRow>(sql`
      SELECT s.id::text, s.code, s.name, s.province_code, s.area_rai::text, s.version,
             ST_AsGeoJSON(s.geom, 15)::jsonb AS geometry
        FROM sites s
       WHERE s.deleted_at IS NULL
         AND ST_Intersects(s.geom, ST_MakeEnvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326))
         AND (${province ?? null}::text IS NULL OR s.province_code = ${province ?? null})
       ORDER BY s.code ASC
    `);
    return result.rows;
  }
}
