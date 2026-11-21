import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { createPool } from './database/pool';
import { HealthController } from './health/health.controller';

@Module({
  controllers: [HealthController],
  providers: [{ provide: Pool, useFactory: createPool }],
})
export class AppModule {}
