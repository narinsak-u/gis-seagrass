import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { isRecord } from '../../../shared';

const scrypt = promisify(scryptCallback);
export const TOKEN_LIFETIME_SECONDS = 900;

export interface AccessTokenClaims {
  sub: string;
  iat: number;
  exp: number;
}

export function requireJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) throw new Error('JWT_SECRET must be configured with at least 32 characters');
  return secret;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('base64url');
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `scrypt$${salt}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [scheme, salt, expectedText] = encoded.split('$');
  if (scheme !== 'scrypt' || !salt || !expectedText) return false;
  const expected = Buffer.from(expectedText, 'base64url');
  const actual = await scrypt(password, salt, expected.length) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signature(message: string, secret = requireJwtSecret()): string {
  return createHmac('sha256', secret).update(message).digest('base64url');
}

export function signAccessToken(userId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const content = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: userId, iat: now, exp: now + TOKEN_LIFETIME_SECONDS })}`;
  return `${content}.${signature(content)}`;
}

// Token verification is shared with protected-route authentication: verify signature and expiry before resolving current user state.
export function verifyAccessToken(token: string, secret = requireJwtSecret()): AccessTokenClaims {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid access token');
  const [headerPart, claimsPart, suppliedSignature] = parts;
  const content = `${headerPart}.${claimsPart}`;
  const expectedSignature = signature(content, secret);
  const supplied = Buffer.from(suppliedSignature, 'base64url');
  const expected = Buffer.from(expectedSignature, 'base64url');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error('Invalid access token');
  try {
    const header: unknown = JSON.parse(Buffer.from(headerPart, 'base64url').toString());
    const claims: unknown = JSON.parse(Buffer.from(claimsPart, 'base64url').toString());
    if (!isRecord(header) || header.alg !== 'HS256' || header.typ !== 'JWT' || !isRecord(claims)
      || typeof claims.sub !== 'string' || typeof claims.iat !== 'number' || typeof claims.exp !== 'number'
      || claims.exp <= Math.floor(Date.now() / 1000) || claims.exp <= claims.iat || claims.exp - claims.iat > TOKEN_LIFETIME_SECONDS) {
      throw new Error('Invalid access token');
    }
    return claims as unknown as AccessTokenClaims;
  } catch {
    throw new Error('Invalid access token');
  }
}
