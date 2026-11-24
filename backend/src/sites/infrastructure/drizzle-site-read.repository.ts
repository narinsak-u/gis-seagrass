import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import { DRIZZLE_DATABASE, sites, type DatabaseProvider } from '../../platform/database';
import type { SiteDetailRow, SiteReadFilters, SiteReadRepository, SiteReadRow } from '../application/site-read.repository';

const SITE_READ_COLUMNS = {
  id: sql<string>`${sites.id}::text`,
  code: sites.code,
  name: sites.name,
  province_code: sites.provinceCode,
  area_rai: sites.areaRai,
  version: sites.version,
};

const SITE_DETAIL_COLUMNS = {
  ...SITE_READ_COLUMNS,
  geometry: sql<SiteDetailRow['geometry']>`ST_AsGeoJSON(${sites.geom}, 15)::jsonb`,
};

@Injectable()
export class DrizzleSiteReadRepository implements SiteReadRepository {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: DatabaseProvider['db']) {}

  async list(filters: SiteReadFilters): Promise<{ rows: SiteReadRow[]; total: number }> {
    const conditions = [isNull(sites.deletedAt)];
    if (filters.province !== undefined) {
      conditions.push(eq(sites.provinceCode, filters.province));
    }
    if (filters.search !== undefined && filters.search.length > 0) {
      conditions.push(
        sql`(strpos(lower(${sites.code}), lower(${filters.search})) > 0 OR strpos(lower(${sites.name}), lower(${filters.search})) > 0)`,
      );
    }
    const where = and(...conditions);
    const [countRows, rows] = await Promise.all([
      this.db.select({ total: count() }).from(sites).where(where),
      this.db
        .select(SITE_READ_COLUMNS)
        .from(sites)
        .where(where)
        .orderBy(asc(sites.code))
        .limit(filters.pageSize)
        .offset((filters.page - 1) * filters.pageSize),
    ]);
    return { rows, total: Number(countRows[0]?.total ?? 0) };
  }

  async detail(code: string): Promise<SiteDetailRow | null> {
    const [row] = await this.db
      .select(SITE_DETAIL_COLUMNS)
      .from(sites)
      .where(and(eq(sites.code, code), isNull(sites.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  async withinBbox(bbox: [number, number, number, number], province?: string): Promise<SiteDetailRow[]> {
    const [minLon, minLat, maxLon, maxLat] = bbox;
    const conditions = [
      isNull(sites.deletedAt),
      sql`ST_Intersects(${sites.geom}, ST_MakeEnvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326))`,
    ];
    if (province !== undefined) {
      conditions.push(eq(sites.provinceCode, province));
    }
    return this.db
      .select(SITE_DETAIL_COLUMNS)
      .from(sites)
      .where(and(...conditions))
      .orderBy(asc(sites.code));
  }
}
