import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { createDatabaseProvider } from './database/provider';
import { runMigrations } from './database/migrate';
import { runImport } from './import/run';
import { requireJwtSecret, seedDevelopmentAccounts } from './auth/auth.module';
import { setupSwagger } from './swagger';

async function bootstrap(): Promise<void> {
  requireJwtSecret();
  const database = createDatabaseProvider();
  try {
    await runMigrations(database);
    await runImport(database);
    await seedDevelopmentAccounts(database.pool, process.env.SEED_DEVELOPMENT_ACCOUNTS === 'true');
    const app = await NestFactory.create(AppModule.register(database), { rawBody: true });
    app.enableShutdownHooks();
    setupSwagger(app);
    await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
  } catch (error) {
    await database.close();
    throw error;
  }
}

void bootstrap().catch((error: unknown) => {
  console.error('API startup failed:', error);
  process.exitCode = 1;
});
