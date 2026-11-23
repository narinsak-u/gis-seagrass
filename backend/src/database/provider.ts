import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';

import { drizzle } from 'drizzle-orm/node-postgres';
import { createPool } from './pool';
import * as schema from './schema';

export const DRIZZLE_DATABASE = Symbol('DRIZZLE_DATABASE');
export const DATABASE_PROVIDER = Symbol('DATABASE_PROVIDER');

export interface DatabaseProvider {
  pool: Pool;
  db: NodePgDatabase<typeof schema>;
  close(): Promise<void>;
}

export function createDatabaseProvider(): DatabaseProvider {
  const pool = createPool();
  const db = drizzle(pool, { schema });
  let closePromise: Promise<void> | undefined;
  return {
    pool,
    db,
    close(): Promise<void> {
      return closePromise ??= pool.end();
    },
  };
}
