import { expect, afterAll, beforeAll, test } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { AppModule } from '../../app.module';
import { runMigrations } from '../../platform/database';
import { createDatabaseProvider, type DatabaseProvider } from '../../platform/database';
import { setupSwagger } from '../../swagger';
import { hashPassword, signAccessToken, verifyAccessToken } from '../application/auth-token';
import { seedDevelopmentAccounts } from '../auth.module';

const testDatabaseUrl = process.env.IMPORT_TEST_DATABASE_URL;
const integration = testDatabaseUrl ? test : test.skip;
const testSecret = 'isolated-integration-signing-secret-32-bytes';
let app: INestApplication | undefined;
let database: DatabaseProvider | undefined;
let pool: Pool | undefined;
let origin = '';
let userId = '';
let email = '';
let generatedEmailPrefix = '';

beforeAll(async () => {
  process.env.JWT_SECRET = testSecret;
  if (!testDatabaseUrl) return;
  const url = new URL(testDatabaseUrl);
  process.env.PGHOST = url.hostname;
  process.env.PGPORT = url.port || '5432';
  process.env.PGUSER = decodeURIComponent(url.username);
  process.env.PGPASSWORD = decodeURIComponent(url.password);
  process.env.PGDATABASE = decodeURIComponent(url.pathname.slice(1));
  const provider = createDatabaseProvider();
  database = provider;
  await runMigrations(provider);
  pool = provider.pool;
  generatedEmailPrefix = `auth-${randomUUID()}`;
  process.env.DEV_ACCOUNT_EMAIL_PREFIX = generatedEmailPrefix;
  email = `${generatedEmailPrefix}@example.test`;
  userId = randomUUID();
  await pool.query(
    'INSERT INTO users (id,email,password_hash,role) VALUES ($1,$2,$3,$4)',
    [userId, email, await hashPassword('correct horse battery staple'), 'admin'],
  );
  app = await NestFactory.create(AppModule.register(provider), { logger: false });
  setupSwagger(app);
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  expect(address && typeof address === 'object').toBeTruthy();
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (pool) {
    await pool.query('DELETE FROM users WHERE id = $1 OR email LIKE $2', [userId, `${generatedEmailPrefix}-%@example.test`]);
  }
  if (app) await app.close();
  else await database?.close();
});

async function login(body: unknown): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await fetch(`${origin}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() as Record<string, unknown> };
}

integration('POST /auth/login issues a short-lived Bearer token for active users', async () => {
  const { response, body } = await login({ email, password: 'correct horse battery staple' });
  expect(response.status).toBe(200);
  expect(body.token_type).toBe('Bearer');
  expect(body.expires_in).toBe(900);
  expect(typeof body.access_token).toBe('string');
  expect(body.password_hash).toBe(undefined);
  expect(body.JWT_SECRET).toBe(undefined);
  const claims = verifyAccessToken(String(body.access_token));
  expect(claims.sub).toBe(userId);
  expect(claims.exp - claims.iat).toBe(900);
});

integration('POST /auth/login uses one generic error for unknown, invalid, and inactive users', async () => {
  const wrongPassword = await login({ email, password: 'wrong password' });
  const unknownEmail = await login({ email: 'missing@example.test', password: 'wrong password' });
  expect([wrongPassword.response.status, wrongPassword.body]).toStrictEqual([unknownEmail.response.status, unknownEmail.body]);
  expect(wrongPassword.response.status).toBe(401);
  expect((wrongPassword.body.error as Record<string, unknown>).code).toBe('UNAUTHORIZED');
  await pool!.query('UPDATE users SET is_active = false WHERE id = $1', [userId]);
  const inactive = await login({ email, password: 'correct horse battery staple' });
  expect(inactive.body).toStrictEqual(wrongPassword.body);
});

integration('POST /auth/login rejects malformed and extra credential fields', async () => {
  for (const body of [{ email, password: 4 }, { email }, { email, password: 'x', role: 'admin' }]) {
    const { response, body: error } = await login(body);
    expect(response.status).toBe(400);
    expect((error.error as Record<string, unknown>).code).toBe('VALIDATION_ERROR');
  }
});
integration('protected request parsing precedes guards, and guards precede request validation', async () => {
  const malformed = await fetch(`${origin}/sites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{',
  });
  expect(malformed.status).toBe(400);
  expect(await malformed.json()).toStrictEqual({
    error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: {} },
  });

  const unauthorized = await fetch(`${origin}/sites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  expect(unauthorized.status).toBe(401);
  expect(await unauthorized.json()).toStrictEqual({
    error: { code: 'UNAUTHORIZED', message: 'Authentication required', details: {} },
  });

  const validationUserId = randomUUID();
  await pool!.query(
    'INSERT INTO users (id,email,password_hash,role) VALUES ($1,$2,$3,$4)',
    [validationUserId, `${generatedEmailPrefix}-validation@example.test`, 'unused', 'admin'],
  );
  try {
    const invalid = await fetch(`${origin}/sites`, {
      method: 'POST',
      headers: { authorization: `Bearer ${signAccessToken(validationUserId)}`, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toStrictEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: {} },
    });
  } finally {
    await pool!.query('DELETE FROM users WHERE id = $1', [validationUserId]);
  }
});

integration('development accounts seed only when enabled and preserve existing accounts', async () => {
  const accountEmail = `${generatedEmailPrefix}-viewer@example.test`;
  await seedDevelopmentAccounts(database!, false);
  expect((await pool!.query('SELECT 1 FROM users WHERE email LIKE $1', [`${generatedEmailPrefix}-%@example.test`])).rowCount).toBe(0);
  await seedDevelopmentAccounts(database!, true);
  const first = await pool!.query('SELECT email, password_hash, role, is_active FROM users WHERE email LIKE $1 ORDER BY email', [`${generatedEmailPrefix}-%@example.test`]);
  expect(first.rowCount).toBe(3);
  for (const role of ['viewer', 'editor', 'admin'] as const) {
    const email = `${generatedEmailPrefix}-${role}@example.test`;
    expect(first.rows.some((row) => row.email === email && row.role === role)).toBe(true);
    const seededLogin = await login({ email, password: `dev-${role}-password` });
    expect(seededLogin.response.status).toBe(200);
  }
  await pool!.query('UPDATE users SET role = $1, is_active = false WHERE email = $2', ['admin', accountEmail]);
  await pool!.query('UPDATE users SET password_hash = $1 WHERE email = $2', ['retained-hash', accountEmail]);
  await seedDevelopmentAccounts(database!, true);
  const preserved = await pool!.query('SELECT password_hash, role, is_active FROM users WHERE email = $1', [accountEmail]);
  expect(preserved.rows[0]).toStrictEqual({ password_hash: 'retained-hash', role: 'admin', is_active: false });
});

integration('protected requests resolve current role and active status for each token', async () => {
  const requestUserId = randomUUID();
  const requestEmail = `${generatedEmailPrefix}-guard@example.test`;
  await pool!.query(
    'INSERT INTO users (id,email,password_hash,role) VALUES ($1,$2,$3,$4)',
    [requestUserId, requestEmail, 'unused', 'admin'],
  );
  const token = signAccessToken(requestUserId);
  const request = () => fetch(`${origin}/sites`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  try {
    await pool!.query('UPDATE users SET role = $1 WHERE id = $2', ['viewer', requestUserId]);
    expect((await request()).status).toBe(403);
    await pool!.query('UPDATE users SET role = $1, is_active = false WHERE id = $2', ['admin', requestUserId]);
    expect((await request()).status).toBe(401);
  } finally {
    await pool!.query('DELETE FROM users WHERE id = $1', [requestUserId]);
  }
});

