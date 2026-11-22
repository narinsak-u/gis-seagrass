import { createHmac, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { BadRequestException, Body, Controller, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { ApiBody, ApiResponse, type SchemaObject } from '@nestjs/swagger';
import { isRecord } from '../domain/guards';
import type { Pool } from 'pg';

const scrypt = promisify(scryptCallback);
const TOKEN_LIFETIME_SECONDS = 900;
const DEVELOPMENT_ACCOUNTS = [
  { role: 'viewer', password: 'dev-viewer-password' },
  { role: 'editor', password: 'dev-editor-password' },
  { role: 'admin', password: 'dev-admin-password' },
] as const;
const dummyPasswordHash = hashPassword('nonexistent-account-password');
export interface AccessTokenClaims {
  sub: string;
  iat: number;
  exp: number;
}
const LOGIN_ERROR_SCHEMA: SchemaObject = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message', 'details'],
      properties: { code: { type: 'string' }, message: { type: 'string' }, details: { type: 'object' } },
    },
  },
};
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

async function verifyPassword(password: string, encoded: string): Promise<boolean> {
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


function invalidCredentials(): UnauthorizedException {
  return new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Invalid email or password', details: {} });
}

@Controller('auth')
export class AuthController {
  constructor(private readonly pool: Pool) {}

  @Post('login')
  @HttpCode(200)
  @ApiBody({ schema: { type: 'object', additionalProperties: false, required: ['email', 'password'], properties: { email: { type: 'string', format: 'email' }, password: { type: 'string' } } } })
  @ApiResponse({ status: 200, description: 'Signed access token', schema: { type: 'object', required: ['access_token', 'token_type', 'expires_in'], properties: { access_token: { type: 'string' }, token_type: { type: 'string', enum: ['Bearer'] }, expires_in: { type: 'integer', enum: [900] } } } })
  @ApiResponse({ status: 400, description: 'Malformed credentials', schema: LOGIN_ERROR_SCHEMA })
  @ApiResponse({ status: 401, description: 'Invalid credentials', schema: LOGIN_ERROR_SCHEMA })
  async login(@Body() body: unknown): Promise<{ access_token: string; token_type: 'Bearer'; expires_in: number }> {
    if (!isRecord(body) || Object.keys(body).length !== 2 || typeof body.email !== 'string' || !body.email
      || typeof body.password !== 'string' || !body.password || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Invalid login request', details: {} });
    }
    const result = await this.pool.query<{ id: string; password_hash: string; is_active: boolean }>(
      'SELECT id, password_hash, is_active FROM users WHERE email = $1', [body.email],
    );
    const user = result.rows[0];
    const passwordMatches = await verifyPassword(body.password, user?.password_hash ?? await dummyPasswordHash);
    if (!user || !user.is_active || !passwordMatches) throw invalidCredentials();
    return { access_token: signAccessToken(user.id), token_type: 'Bearer', expires_in: TOKEN_LIFETIME_SECONDS };
  }
}

export async function seedDevelopmentAccounts(pool: Pool, enabled: boolean): Promise<void> {
  if (!enabled) return;
  const prefix = process.env.DEV_ACCOUNT_EMAIL_PREFIX ?? 'dev';
  for (const account of DEVELOPMENT_ACCOUNTS) {
    const email = `${prefix}-${account.role}@example.test`;
    const existing = await pool.query('SELECT 1 FROM users WHERE email = $1', [email]);
    if (existing.rowCount) continue;
    await pool.query(
      'INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING',
      [randomUUID(), email, await hashPassword(account.password), account.role],
    );
  }
}
