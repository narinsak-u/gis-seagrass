import {
  Controller,
  Get,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Pool } from 'pg';

@Controller('health')
export class HealthController {

  constructor(private readonly pool: Pool) {}

  @Get()
  async check(): Promise<{ db: 'ok'; postgis: string }> {
    try {
      const result = await this.pool.query<{ version: string }>(
        'SELECT PostGIS_Lib_Version() AS version',
      );
      const version = result.rows[0]?.version;
      if (!version?.startsWith('3.')) {
        throw new Error('PostGIS 3.x is required');
      }
      return { db: 'ok', postgis: version };
    } catch {
      throw new ServiceUnavailableException();
    }
  }


}
