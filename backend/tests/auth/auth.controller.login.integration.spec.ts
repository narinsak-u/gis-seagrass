import { expect, afterAll, beforeAll, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { signAccessToken, verifyAccessToken } from '../../src/auth/application/auth-token';
import { seedDevelopmentAccounts } from '../../src/auth/auth.module';
import { createAuthFixture } from './auth-fixture';

const testDatabaseUrl = process.env.IMPORT_TEST_DATABASE_URL;
const integration = testDatabaseUrl ? test : test.skip;
const fixture = createAuthFixture();

beforeAll(async () => fixture.start());
afterAll(async () => fixture.close());

async function login(body: unknown): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await fetch(`${fixture.origin}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() as Record<string, unknown> };
}

integration('POST /auth/login issues a short-lived Bearer token for active users', async () => {
  const { response, body } = await login({ email: fixture.email, password: 'correct horse battery staple' });
  expect(response.status).toBe(200);
  expect(body.token_type).toBe('Bearer');
  expect(body.expires_in).toBe(900);
  expect(typeof body.access_token).toBe('string');
  expect(body.password_hash).toBe(undefined);
  expect(body.JWT_SECRET).toBe(undefined);
  const claims = verifyAccessToken(String(body.access_token));
  expect(claims.sub).toBe(fixture.userId);
  expect(claims.exp - claims.iat).toBe(900);
});

integration('POST /auth/login uses one generic error for unknown, invalid, and inactive users', async () => {
  const wrongPassword = await login({ email: fixture.email, password: 'wrong password' });
  const unknownEmail = await login({ email: 'missing@example.test', password: 'wrong password' });
  expect([wrongPassword.response.status, wrongPassword.body]).toStrictEqual([unknownEmail.response.status, unknownEmail.body]);
  expect(wrongPassword.response.status).toBe(401);
  expect((wrongPassword.body.error as Record<string, unknown>).code).toBe('UNAUTHORIZED');
  await fixture.pool!.query('UPDATE users SET is_active = false WHERE id = $1', [fixture.userId]);
  const inactive = await login({ email: fixture.email, password: 'correct horse battery staple' });
  expect(inactive.body).toStrictEqual(wrongPassword.body);
});

integration('POST /auth/login rejects malformed and extra credential fields', async () => {
  for (const body of [{ email: fixture.email, password: 4 }, { email: fixture.email }, { email: fixture.email, password: 'x', role: 'admin' }]) {
    const { response, body: error } = await login(body);
    expect(response.status).toBe(400);
    expect((error.error as Record<string, unknown>).code).toBe('VALIDATION_ERROR');
  }
});
integration('protected request parsing precedes guards, and guards precede request validation', async () => {
  const malformed = await fetch(`${fixture.origin}/sites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{',
  });
  expect(malformed.status).toBe(400);
  expect(await malformed.json()).toStrictEqual({
    error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: {} },
  });

  const unauthorized = await fetch(`${fixture.origin}/sites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  expect(unauthorized.status).toBe(401);
  expect(await unauthorized.json()).toStrictEqual({
    error: { code: 'UNAUTHORIZED', message: 'Authentication required', details: {} },
  });

  const validationUserId = randomUUID();
  await fixture.pool!.query(
    'INSERT INTO users (id,email,password_hash,role) VALUES ($1,$2,$3,$4)',
    [validationUserId, `${fixture.generatedEmailPrefix}-validation@example.test`, 'unused', 'admin'],
  );
  try {
    const invalid = await fetch(`${fixture.origin}/sites`, {
      method: 'POST',
      headers: { authorization: `Bearer ${signAccessToken(validationUserId)}`, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toStrictEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: {} },
    });
  } finally {
    await fixture.pool!.query('DELETE FROM users WHERE id = $1', [validationUserId]);
  }
});

integration('development accounts seed only when enabled and preserve existing accounts', async () => {
  const accountEmail = `${fixture.generatedEmailPrefix}-viewer@example.test`;
  await seedDevelopmentAccounts(fixture.database!, false);
  expect((await fixture.pool!.query('SELECT 1 FROM users WHERE email LIKE $1', [`${fixture.generatedEmailPrefix}-%@example.test`])).rowCount).toBe(0);
  await seedDevelopmentAccounts(fixture.database!, true);
  const first = await fixture.pool!.query('SELECT email, password_hash, role, is_active FROM users WHERE email LIKE $1 ORDER BY email', [`${fixture.generatedEmailPrefix}-%@example.test`]);
  expect(first.rowCount).toBe(3);
  for (const role of ['viewer', 'editor', 'admin'] as const) {
    const email = `${fixture.generatedEmailPrefix}-${role}@example.test`;
    expect(first.rows.some((row) => row.email === email && row.role === role)).toBe(true);
    const seededLogin = await login({ email, password: `dev-${role}-password` });
    expect(seededLogin.response.status).toBe(200);
  }
  await fixture.pool!.query('UPDATE users SET role = $1, is_active = false WHERE email = $2', ['admin', accountEmail]);
  await fixture.pool!.query('UPDATE users SET password_hash = $1 WHERE email = $2', ['retained-hash', accountEmail]);
  await seedDevelopmentAccounts(fixture.database!, true);
  const preserved = await fixture.pool!.query('SELECT password_hash, role, is_active FROM users WHERE email = $1', [accountEmail]);
  expect(preserved.rows[0]).toStrictEqual({ password_hash: 'retained-hash', role: 'admin', is_active: false });
});

integration('protected requests resolve current role and active status for each token', async () => {
  const requestUserId = randomUUID();
  const requestEmail = `${fixture.generatedEmailPrefix}-guard@example.test`;
  await fixture.pool!.query(
    'INSERT INTO users (id,email,password_hash,role) VALUES ($1,$2,$3,$4)',
    [requestUserId, requestEmail, 'unused', 'admin'],
  );
  const token = signAccessToken(requestUserId);
  const request = () => fetch(`${fixture.origin}/sites`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  try {
    await fixture.pool!.query('UPDATE users SET role = $1 WHERE id = $2', ['viewer', requestUserId]);
    expect((await request()).status).toBe(403);
    await fixture.pool!.query('UPDATE users SET role = $1, is_active = false WHERE id = $2', ['admin', requestUserId]);
    expect((await request()).status).toBe(401);
  } finally {
    await fixture.pool!.query('DELETE FROM users WHERE id = $1', [requestUserId]);
  }
});

integration('POST /auth/login and /auth/login/ count malformed attempts toward the shared limit', async () => {
  const attempt = (body: string, path: string, contentType = 'application/json') => fetch(`${fixture.origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': contentType, 'x-forwarded-for': '203.0.113.8' },
    body,
  });
  for (let count = 0; count < 20; count++) {
    const malformedJson = count % 2 === 0;
    const path = malformedJson ? '/auth/login' : '/auth/login/';
    const contentType = malformedJson ? 'application/json' : 'application/json; charset=unsupported';
    expect((await attempt(malformedJson ? '{' : JSON.stringify({}), path, contentType)).status).toBe(400);
  }

  const limited = await attempt('{', '/auth/login/', 'application/json; charset=unsupported');
  expect(limited.status).toBe(429);
  expect(Object.keys(await limited.json() as Record<string, unknown>)).toStrictEqual(['error']);

  const error = (await (await fetch(`${fixture.origin}/auth/me`)).json() as Record<string, unknown>).error as Record<string, unknown>;
  expect(Object.keys(error).sort()).toStrictEqual(['code', 'details', 'message']);
});
