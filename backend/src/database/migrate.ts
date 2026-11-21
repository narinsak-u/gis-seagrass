import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createPool } from './pool';

export async function runMigrations(): Promise<void> {
  const pool = createPool();
  try {
    await migrate(drizzle(pool), {
      migrationsFolder: join(process.cwd(), 'src/database/migrations'),
    });
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  void runMigrations().catch((error: unknown) => {
    console.error('Database migration failed:', error);
    process.exitCode = 1;
  });
}
