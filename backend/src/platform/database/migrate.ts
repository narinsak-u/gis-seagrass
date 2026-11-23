import { join } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabaseProvider, type DatabaseProvider } from './provider';

export async function runMigrations(provider?: DatabaseProvider): Promise<void> {
  const ownsProvider = !provider;
  const database = provider ?? createDatabaseProvider();
  try {
    await migrate(database.db, {
      migrationsFolder: join(process.cwd(), 'src/platform/database/migrations'),
    });
  } finally {
    if (ownsProvider) await database.close();
  }
}

if (require.main === module) {
  void runMigrations().catch((error: unknown) => {
    console.error('Database migration failed:', error);
    process.exitCode = 1;
  });
}
