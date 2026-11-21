import { Pool } from 'pg';

export function createPool(): Pool {
  return new Pool({
    host: process.env.PGHOST ?? 'db',
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? 'seagrass',
    password: process.env.PGPASSWORD ?? 'seagrass_dev_only',
    database: process.env.PGDATABASE ?? 'seagrass',
  });
}
