import { type DynamicModule, Module } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_PROVIDER, DRIZZLE_DATABASE, type DatabaseProvider } from './provider';

@Module({})
export class DatabaseModule {
  static register(database: DatabaseProvider): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [
        { provide: Pool, useValue: database.pool },
        { provide: DRIZZLE_DATABASE, useValue: database.db },
        { provide: DATABASE_PROVIDER, useValue: database },
      ],
      exports: [Pool, DRIZZLE_DATABASE, DATABASE_PROVIDER],
    };
  }
}
