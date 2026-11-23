import type { Pool } from 'pg';

const IMPORT_LOCK_KEY = 192837465;

export async function withImportAdvisoryLock<T>(pool: Pool, work: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query('SELECT pg_advisory_lock($1)', [IMPORT_LOCK_KEY]);
    locked = true;
    return await work();
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock($1)', [IMPORT_LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}
