import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { runMigrations } from './database/migrate';
import { runImport } from './import/run';
import { createPool } from './database/pool';
import { requireJwtSecret, seedDevelopmentAccounts } from './auth/auth.controller';
import { setupSwagger } from './swagger';

async function bootstrap(): Promise<void> {
  requireJwtSecret();
  await runMigrations();
  await runImport();
  const pool = createPool();
  try {
    await seedDevelopmentAccounts(pool, process.env.SEED_DEVELOPMENT_ACCOUNTS === 'true');
  } finally {
    await pool.end();
  }
  const app = await NestFactory.create(AppModule, { rawBody: true });
  setupSwagger(app);
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
}

void bootstrap().catch((error: unknown) => {
  console.error('API startup failed:', error);
  process.exitCode = 1;
});
