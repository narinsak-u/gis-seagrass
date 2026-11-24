import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE_DATABASE, type DatabaseProvider } from '../../platform/database';
import type { ProvinceGeoJsonRow, ProvinceReadRepository } from '../application/province-read.repository';

@Injectable()
export class DrizzleProvinceReadRepository implements ProvinceReadRepository {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: DatabaseProvider['db']) {}

  async withinBbox(bbox: [number, number, number, number]): Promise<ProvinceGeoJsonRow[]> {
    const [minLon, minLat, maxLon, maxLat] = bbox;
    const result = await this.db.execute<ProvinceGeoJsonRow>(sql`
      SELECT p.code, p.name_th,
             ST_AsGeoJSON(p.geom, 15)::jsonb AS geometry
        FROM provinces p
       WHERE ST_Intersects(p.geom, ST_MakeEnvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326))
       ORDER BY p.code ASC
    `);
    return result.rows;
  }
}
