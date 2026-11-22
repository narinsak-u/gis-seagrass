import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { runMigrations } from './database/migrate';
import { runImport } from './import/run';

async function bootstrap(): Promise<void> {
  await runMigrations();
  await runImport();
  const app = await NestFactory.create(AppModule);
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
}

void bootstrap().catch((error: unknown) => {
  console.error('API startup failed:', error);
  process.exitCode = 1;
});
