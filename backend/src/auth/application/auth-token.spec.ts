import { createHmac, randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { signAccessToken, verifyAccessToken } from './auth-token';

const testSecret = 'isolated-integration-signing-secret-32-bytes';

test('access token verification rejects altered signatures and expired tokens', () => {
  process.env.JWT_SECRET = testSecret;
  const token = signAccessToken(randomUUID());
  const claims = verifyAccessToken(token);
  expect(claims.exp - claims.iat).toBe(900);
  const [header, payload, signature] = token.split('.');
  const alteredSignature = `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
  expect(() => verifyAccessToken(`${header}.${payload}.${alteredSignature}`)).toThrow(/Invalid access token/);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const content = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: randomUUID(), iat: 1, exp: 2 })}`;
  const expiredSignature = createHmac('sha256', testSecret).update(content).digest('base64url');
  expect(() => verifyAccessToken(`${content}.${expiredSignature}`)).toThrow(/Invalid access token/);
});
