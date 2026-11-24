import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { runMigrations, createDatabaseProvider, type DatabaseProvider } from '../../src/platform/database';
import { configureLoginBodyParsing } from '../../src/auth/presentation/malformed-login-json.middleware';
import { setupSwagger } from '../../src/swagger';
import { hashPassword } from '../../src/auth/application/auth-token';
import type { Pool } from 'pg';

export const testSecret = 'isolated-integration-signing-secret-32-bytes';
export function createAuthFixture() {
  const testDatabaseUrl = process.env.IMPORT_TEST_DATABASE_URL;
  const fixture: {
    app?: NestExpressApplication;
    database?: DatabaseProvider;
    pool?: Pool;
    origin: string;
    userId: string;
    email: string;
    generatedEmailPrefix: string;
    start(): Promise<void>;
    close(): Promise<void>;
  } = {
    origin: '',
    userId: '',
    email: '',
    generatedEmailPrefix: '',
    async start() {
      process.env.JWT_SECRET = testSecret;
      if (!testDatabaseUrl) return;
      const url = new URL(testDatabaseUrl);
      process.env.PGHOST = url.hostname;
      process.env.PGPORT = url.port || '5432';
      process.env.PGUSER = decodeURIComponent(url.username);
      process.env.PGPASSWORD = decodeURIComponent(url.password);
      process.env.PGDATABASE = decodeURIComponent(url.pathname.slice(1));
      const provider = createDatabaseProvider();
      fixture.database = provider;
      await runMigrations(provider);
      fixture.pool = provider.pool;
      fixture.generatedEmailPrefix = `auth-${randomUUID()}`;
      process.env.DEV_ACCOUNT_EMAIL_PREFIX = fixture.generatedEmailPrefix;
      fixture.email = `${fixture.generatedEmailPrefix}@example.test`;
      fixture.userId = randomUUID();
      await fixture.pool.query(
        'INSERT INTO users (id,email,password_hash,role) VALUES ($1,$2,$3,$4)',
        [fixture.userId, fixture.email, await hashPassword('correct horse battery staple'), 'admin'],
      );
      fixture.app = await NestFactory.create<NestExpressApplication>(AppModule.register(provider), { logger: false, rawBody: true, bodyParser: false });
      configureLoginBodyParsing(fixture.app);
      fixture.app.getHttpAdapter().getInstance().set('trust proxy', 1);
      setupSwagger(fixture.app);
      await fixture.app.listen(0, '127.0.0.1');
      const address = fixture.app.getHttpServer().address();
      if (!address || typeof address === 'string') throw new Error('Test server is not listening');
      fixture.origin = `http://127.0.0.1:${address.port}`;
    },
    async close() {
      if (fixture.pool) {
        await fixture.pool.query('DELETE FROM users WHERE id = $1 OR email LIKE $2', [fixture.userId, `${fixture.generatedEmailPrefix}-%@example.test`]);
      }
      if (fixture.app) await fixture.app.close();
      else await fixture.database?.close();
    },
  };
  return fixture;
}
