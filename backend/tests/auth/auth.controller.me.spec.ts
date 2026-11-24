import { expect, afterAll, beforeAll, test } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import { hashPassword, signAccessToken } from '../../src/auth/application/auth-token';
import { createAuthFixture, testSecret } from './auth-fixture';

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

integration('GET /auth/me returns current email and role and reflects database role changes on the next request', async () => {
  const meUserId = randomUUID();
  const meEmail = `${fixture.generatedEmailPrefix}-me@example.test`;
  await fixture.pool!.query(
    'INSERT INTO users (id,email,password_hash,role) VALUES ($1,$2,$3,$4)',
    [meUserId, meEmail, await hashPassword('me-test-password'), 'viewer'],
  );
  try {
    const loginResult = await login({ email: meEmail, password: 'me-test-password' });
    expect(loginResult.response.status).toBe(200);
    const token = String(loginResult.body.access_token);

    const first = await fetch(`${fixture.origin}/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(first.status).toBe(200);
    expect(await first.json()).toStrictEqual({ email: meEmail, role: 'viewer' });

    await fixture.pool!.query('UPDATE users SET role = $1 WHERE id = $2', ['editor', meUserId]);
    const second = await fetch(`${fixture.origin}/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(second.status).toBe(200);
    expect(await second.json()).toStrictEqual({ email: meEmail, role: 'editor' });

    await fixture.pool!.query('UPDATE users SET role = $1 WHERE id = $2', ['admin', meUserId]);
    const third = await fetch(`${fixture.origin}/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(third.status).toBe(200);
    expect(await third.json()).toStrictEqual({ email: meEmail, role: 'admin' });
  } finally {
    await fixture.pool!.query('DELETE FROM users WHERE id = $1', [meUserId]);
  }
});

integration('GET /auth/me rejects missing, invalid, expired, inactive, and deleted user tokens with 401 in the shared error envelope', async () => {
  const expectedEnvelope = {
    error: { code: 'UNAUTHORIZED', message: 'Authentication required', details: {} },
  };
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

  const meUserId = randomUUID();
  const meEmail = `${fixture.generatedEmailPrefix}-me-reject@example.test`;
  await fixture.pool!.query(
    'INSERT INTO users (id,email,password_hash,role) VALUES ($1,$2,$3,$4)',
    [meUserId, meEmail, 'unused', 'viewer'],
  );
  const validToken = signAccessToken(meUserId);
  const [header, payload, signature] = validToken.split('.');
  const alteredToken = `${header}.${payload}.${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
  const expiredContent = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: meUserId, iat: 1, exp: 2 })}`;
  const expiredToken = `${expiredContent}.${createHmac('sha256', testSecret).update(expiredContent).digest('base64url')}`;

  try {
    const missing = await fetch(`${fixture.origin}/auth/me`);
    expect(missing.status).toBe(401);
    expect(await missing.json()).toStrictEqual(expectedEnvelope);

    for (const authorization of ['Basic abc', 'Bearer ', 'Bearer not-a-jwt', `Bearer ${alteredToken}`, `Bearer ${expiredToken}`]) {
      const response = await fetch(`${fixture.origin}/auth/me`, { headers: { authorization } });
      expect(response.status).toBe(401);
      expect(await response.json()).toStrictEqual(expectedEnvelope);
    }

    await fixture.pool!.query('UPDATE users SET is_active = false WHERE id = $1', [meUserId]);
    const inactive = await fetch(`${fixture.origin}/auth/me`, {
      headers: { authorization: `Bearer ${validToken}` },
    });
    expect(inactive.status).toBe(401);
    expect(await inactive.json()).toStrictEqual(expectedEnvelope);

    await fixture.pool!.query('DELETE FROM users WHERE id = $1', [meUserId]);
    const deleted = await fetch(`${fixture.origin}/auth/me`, {
      headers: { authorization: `Bearer ${validToken}` },
    });
    expect(deleted.status).toBe(401);
    expect(await deleted.json()).toStrictEqual(expectedEnvelope);
  } finally {
    await fixture.pool!.query('DELETE FROM users WHERE id = $1', [meUserId]);
  }
});

integration('Swagger documents login and current-identity endpoints with Bearer auth and error envelopes', async () => {
  const response = await fetch(`${fixture.origin}/docs-json`);
  expect(response.status).toBe(200);
  const document = await response.json() as {
    paths: Record<string, {
      post?: { requestBody?: unknown; responses?: Record<string, { content?: Record<string, { schema?: unknown }> }> };
      get?: { security?: Array<Record<string, unknown>>; responses?: Record<string, { content?: Record<string, { schema?: unknown }> }> };
    }>;
  };
  const loginOperation = document.paths['/auth/login']?.post!;
  expect(loginOperation?.requestBody).toBeTruthy();
  expect(loginOperation.responses?.['200']?.content?.['application/json']?.schema).toBeTruthy();
  expect(loginOperation.responses?.['400']?.content?.['application/json']?.schema).toBeTruthy();
  expect(loginOperation.responses?.['401']?.content?.['application/json']?.schema).toBeTruthy();

  const meOperation = document.paths['/auth/me']?.get!;
  expect(meOperation).toBeTruthy();
  expect(meOperation.security?.some((entry) => 'access-token' in entry)).toBeTruthy();
  expect(meOperation.responses?.['200']?.content?.['application/json']?.schema).toBeTruthy();
  expect(meOperation.responses?.['401']?.content?.['application/json']?.schema).toBeTruthy();
});
