import { Inject, Injectable } from '@nestjs/common';
import { asc, sql } from 'drizzle-orm';
import { DRIZZLE_DATABASE, provinces, type DatabaseProvider } from '../../platform/database';
import type { ProvinceGeoJsonRow, ProvinceReadRepository } from '../application/province-read.repository';

@Injectable()
export class DrizzleProvinceReadRepository implements ProvinceReadRepository {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: DatabaseProvider['db']) {}

  async withinBbox(bbox: [number, number, number, number]): Promise<ProvinceGeoJsonRow[]> {
    const [minLon, minLat, maxLon, maxLat] = bbox;
    return this.db
      .select({
        code: provinces.code,
        name_th: provinces.nameTh,
        geometry: sql<ProvinceGeoJsonRow['geometry']>`ST_AsGeoJSON(${provinces.geom}, 15)::jsonb`,
      })
      .from(provinces)
      .where(sql`ST_Intersects(${provinces.geom}, ST_MakeEnvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326))`)
      .orderBy(asc(provinces.code));
  }
}
