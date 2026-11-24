import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { AppModule } from '../app.module';
import { runMigrations } from '../platform/database';
import { createDatabaseProvider, type DatabaseProvider } from '../platform/database';
import { setupSwagger } from '../swagger';
import { hashPassword, signAccessToken, verifyAccessToken } from './application/auth-token';
import { seedDevelopmentAccounts } from './auth.module';

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

before(async () => {
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
  assert.ok(address && typeof address === 'object');
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
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
  assert.equal(response.status, 200);
  assert.equal(body.token_type, 'Bearer');
  assert.equal(body.expires_in, 900);
  assert.equal(typeof body.access_token, 'string');
  assert.equal(body.password_hash, undefined);
  assert.equal(body.JWT_SECRET, undefined);
  const claims = verifyAccessToken(String(body.access_token));
  assert.equal(claims.sub, userId);
  assert.equal(claims.exp - claims.iat, 900);
});

integration('POST /auth/login uses one generic error for unknown, invalid, and inactive users', async () => {
  const wrongPassword = await login({ email, password: 'wrong password' });
  const unknownEmail = await login({ email: 'missing@example.test', password: 'wrong password' });
  assert.deepEqual([wrongPassword.response.status, wrongPassword.body], [unknownEmail.response.status, unknownEmail.body]);
  assert.equal(wrongPassword.response.status, 401);
  assert.equal((wrongPassword.body.error as Record<string, unknown>).code, 'UNAUTHORIZED');
  await pool!.query('UPDATE users SET is_active = false WHERE id = $1', [userId]);
  const inactive = await login({ email, password: 'correct horse battery staple' });
  assert.deepEqual(inactive.body, wrongPassword.body);
});

integration('POST /auth/login rejects malformed and extra credential fields', async () => {
  for (const body of [{ email, password: 4 }, { email }, { email, password: 'x', role: 'admin' }]) {
    const { response, body: error } = await login(body);
    assert.equal(response.status, 400);
    assert.equal((error.error as Record<string, unknown>).code, 'VALIDATION_ERROR');
  }
});
integration('protected request parsing precedes guards, and guards precede request validation', async () => {
  const malformed = await fetch(`${origin}/sites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{',
  });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), {
    error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: {} },
  });

  const unauthorized = await fetch(`${origin}/sites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(unauthorized.status, 401);
  assert.deepEqual(await unauthorized.json(), {
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
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), {
      error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: {} },
    });
  } finally {
    await pool!.query('DELETE FROM users WHERE id = $1', [validationUserId]);
  }
});

integration('development accounts seed only when enabled and preserve existing accounts', async () => {
  const accountEmail = `${generatedEmailPrefix}-viewer@example.test`;
  await seedDevelopmentAccounts(database!, false);
  assert.equal((await pool!.query('SELECT 1 FROM users WHERE email LIKE $1', [`${generatedEmailPrefix}-%@example.test`])).rowCount, 0);
  await seedDevelopmentAccounts(database!, true);
  const first = await pool!.query('SELECT email, password_hash, role, is_active FROM users WHERE email LIKE $1 ORDER BY email', [`${generatedEmailPrefix}-%@example.test`]);
  assert.equal(first.rowCount, 3);
  for (const role of ['viewer', 'editor', 'admin'] as const) {
    const email = `${generatedEmailPrefix}-${role}@example.test`;
    assert.equal(first.rows.some((row) => row.email === email && row.role === role), true);
    const seededLogin = await login({ email, password: `dev-${role}-password` });
    assert.equal(seededLogin.response.status, 200);
  }
  await pool!.query('UPDATE users SET role = $1, is_active = false WHERE email = $2', ['admin', accountEmail]);
  await pool!.query('UPDATE users SET password_hash = $1 WHERE email = $2', ['retained-hash', accountEmail]);
  await seedDevelopmentAccounts(database!, true);
  const preserved = await pool!.query('SELECT password_hash, role, is_active FROM users WHERE email = $1', [accountEmail]);
  assert.deepEqual(preserved.rows[0], { password_hash: 'retained-hash', role: 'admin', is_active: false });
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
    assert.equal((await request()).status, 403);
    await pool!.query('UPDATE users SET role = $1, is_active = false WHERE id = $2', ['admin', requestUserId]);
    assert.equal((await request()).status, 401);
  } finally {
    await pool!.query('DELETE FROM users WHERE id = $1', [requestUserId]);
  }
});

integration('Swagger documents login request, success, and error envelopes', async () => {
  const response = await fetch(`${origin}/docs-json`);
  assert.equal(response.status, 200);
  const document = await response.json() as { paths: Record<string, { post?: { requestBody?: unknown; responses?: Record<string, { content?: Record<string, { schema?: unknown }> }> } }> };
  const loginOperation = document.paths['/auth/login']?.post;
  assert.ok(loginOperation?.requestBody);
  assert.ok(loginOperation.responses?.['200']?.content?.['application/json']?.schema);
  assert.ok(loginOperation.responses?.['400']?.content?.['application/json']?.schema);
  assert.ok(loginOperation.responses?.['401']?.content?.['application/json']?.schema);
});

test('API process refuses startup without JWT_SECRET before accessing the database', () => {
  const { status, stderr, stdout } = spawnSync(process.execPath, [join(__dirname, '../main.js')], {
    cwd: join(__dirname, '../..'),
    encoding: 'utf8',
    env: { ...process.env, JWT_SECRET: '' },
  });
  assert.equal(status, 1);
  assert.match(`${stderr}${stdout}`, /JWT_SECRET must be configured/);
});

test('access token verification rejects altered signatures and expired tokens', () => {
  process.env.JWT_SECRET = testSecret;
  const token = signAccessToken(randomUUID());
  const claims = verifyAccessToken(token);
  assert.equal(claims.exp - claims.iat, 900);
  const [header, payload, signature] = token.split('.');
  const alteredSignature = `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
  assert.throws(() => verifyAccessToken(`${header}.${payload}.${alteredSignature}`), /Invalid access token/);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const content = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: randomUUID(), iat: 1, exp: 2 })}`;
  const expiredSignature = createHmac('sha256', testSecret).update(content).digest('base64url');
  assert.throws(() => verifyAccessToken(`${content}.${expiredSignature}`), /Invalid access token/);
});
