import { afterAll, beforeAll } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { AppModule } from '../../src/app.module';
import { createDatabaseProvider, type DatabaseProvider, runMigrations } from '../../src/platform/database';
import { setupSwagger } from '../../src/swagger';
import { signAccessToken } from '../../src/auth/application/auth-token';

export interface SurveyFixture {
  pool: Pool;
  origin: string;
  provinceCode: string;
  siteCode: string;
  deletedSiteCode: string;
  siteId: string;
  speciesCodes: [string, string];
  users: Record<'viewer' | 'editor' | 'admin', string>;
  request(path: string, method?: string, body?: unknown, token?: string): Promise<{ response: Response; body: Record<string, unknown> }>;
  requestText(path: string, method?: string, body?: string, token?: string): Promise<{ response: Response; body: Record<string, unknown> }>;
  accessToken(role: 'viewer' | 'editor' | 'admin'): string;
  signedToken(sub: string, iat: number, exp: number): string;
  expiredToken(): string;
  create(body: unknown, code?: string, token?: string | null): Promise<{ response: Response; body: Record<string, unknown> }>;
  todayAndDates(): Promise<{ today: string; yesterday: string; tomorrow: string }>;
  validSurvey(overrides?: Record<string, unknown>): Promise<Record<string, unknown>>;
  resetSurveys(): Promise<void>;
  status(): Promise<Record<string, unknown>>;
  waitForSiteLock(): Promise<boolean>;
  cleanup(): Promise<void>;
}

export async function createSurveyFixture(): Promise<SurveyFixture> {
  const testDatabaseUrl = process.env.IMPORT_TEST_DATABASE_URL;
  process.env.JWT_SECRET ??= 'isolated-integration-signing-secret-32-bytes';
  if (!testDatabaseUrl) throw new Error('IMPORT_TEST_DATABASE_URL is required');
  const url = new URL(testDatabaseUrl);
  process.env.PGHOST = url.hostname;
  process.env.PGPORT = url.port || '5432';
  process.env.PGUSER = decodeURIComponent(url.username);
  process.env.PGPASSWORD = decodeURIComponent(url.password);
  process.env.PGDATABASE = decodeURIComponent(url.pathname.slice(1));
  const database: DatabaseProvider = createDatabaseProvider();
  await runMigrations(database);
  const pool: Pool = database.pool;
  let provinceCode = '';
  let siteCode = '';
  let deletedSiteCode = '';
  let speciesCodes: [string, string] = ['', ''];
  let createdProvinceCode = '';
  let createdSiteCodes: string[] = [];
  let createdSpeciesCodes: string[] = [];
  let users: Record<'viewer' | 'editor' | 'admin', string> = { viewer: '', editor: '', admin: '' };
  let origin = '';
  let siteId = '';
  do {
    const token = randomUUID().replaceAll('-', '').toUpperCase();
    provinceCode = token.slice(0, 2);
    siteCode = `SURVEY-${token.slice(2, 18)}`;
    deletedSiteCode = `RETIRED-${token.slice(18, 34)}`;
    speciesCodes = [`TEST-A${token.slice(0, 16)}`, `TEST-B${token.slice(16, 32)}`];
    const existing = await pool.query(
      'SELECT 1 FROM provinces WHERE code = $1 UNION ALL SELECT 1 FROM sites WHERE code = ANY($2::text[]) UNION ALL SELECT 1 FROM species WHERE code = ANY($3::text[])',
      [provinceCode, [siteCode, deletedSiteCode], speciesCodes],
    );
    if (!existing.rowCount) break;
  } while (true);
  await pool.query('INSERT INTO species (code,name_th,name_sci) VALUES ($1,$1,$1),($2,$2,$2)', speciesCodes);
  createdSpeciesCodes = speciesCodes;
  await pool.query(
    `INSERT INTO provinces (code,name_th,geom)
     VALUES ($1,'Survey test province',ST_Multi(ST_GeomFromText('POLYGON((99 9,101 9,101 11,99 11,99 9))',4326)))`,
    [provinceCode],
  );
  createdProvinceCode = provinceCode;
  const sites = await pool.query<{ id: string; code: string }>(
    `INSERT INTO sites (code,name,province_code,geom,area_rai,deleted_at)
     VALUES
       ($1,'Survey test site',$3,ST_Multi(ST_GeomFromText('POLYGON((100.15 10.15,100.15005 10.15,100.15005 10.15005,100.15 10.15005,100.15 10.15))',4326)),1,NULL),
       ($2,'Retired test site',$3,ST_Multi(ST_GeomFromText('POLYGON((100.16 10.16,100.16005 10.16,100.16005 10.16005,100.16 10.16005,100.16 10.16))',4326)),1,now())
     RETURNING id,code`,
    [siteCode, deletedSiteCode, provinceCode],
  );
  createdSiteCodes = sites.rows.map(({ code }) => code);
  siteId = sites.rows.find(({ code }) => code === siteCode)?.id ?? '';
  users = { viewer: randomUUID(), editor: randomUUID(), admin: randomUUID() };
  await pool.query(
    'INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, $4), ($5, $6, $7, $8), ($9, $10, $11, $12)',
    [users.viewer, `${randomUUID()}@example.test`, 'unused', 'viewer', users.editor, `${randomUUID()}@example.test`, 'unused', 'editor', users.admin, `${randomUUID()}@example.test`, 'unused', 'admin'],
  );
  const server = await NestFactory.create(AppModule.register(database), { logger: false, rawBody: true });
  setupSwagger(server);
  await server.listen(0, '127.0.0.1');
  const address = server.getHttpServer().address();
  if (!address || typeof address !== 'object') throw new Error('Survey test server did not bind');
  origin = `http://127.0.0.1:${address.port}`;

  async function request(path: string, method = 'GET', body?: unknown, token?: string) {
    return requestText(path, method, body === undefined ? undefined : JSON.stringify(body), token);
  }
  async function requestText(path: string, method = 'GET', body?: string, token?: string) {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetch(`${origin}${path}`, { method, headers, body });
    return { response, body: response.status === 204 ? {} : await response.json() as Record<string, unknown> };
  }
  function accessToken(role: 'viewer' | 'editor' | 'admin'): string {
    return signAccessToken(users[role]);
  }
  function signedToken(sub: string, iat: number, exp: number): string {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const content = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub, iat, exp })}`;
    const signature = createHmac('sha256', process.env.JWT_SECRET!).update(content).digest('base64url');
    return `${content}.${signature}`;
  }
  function expiredToken(): string {
    return signedToken(users.viewer, 1, 2);
  }
  async function create(body: unknown, code = siteCode, token: string | null = accessToken('admin')) {
    return request(`/sites/${code}/surveys`, 'POST', body, token ?? undefined);
  }
  async function todayAndDates(): Promise<{ today: string; yesterday: string; tomorrow: string }> {
    const result = await pool.query<{ today: string; yesterday: string; tomorrow: string }>(
      `SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::date::text AS today,
              ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::date - 1)::text AS yesterday,
              ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::date + 1)::text AS tomorrow`,
    );
    return result.rows[0];
  }
  async function validSurvey(overrides: Record<string, unknown> = {}) {
    const { today } = await todayAndDates();
    return { lon: 100.150025, lat: 10.150025, surveyed_on: today, cover_percent: 40, species: [speciesCodes[0]], ...overrides };
  }
  async function resetSurveys(): Promise<void> {
    await pool.query('DELETE FROM survey_species WHERE survey_id IN (SELECT id FROM surveys WHERE site_id = $1)', [siteId]);
    await pool.query('DELETE FROM surveys WHERE site_id = $1', [siteId]);
  }
  async function status(): Promise<Record<string, unknown>> {
    const response = await request(`/sites/${siteCode}/surveys`, 'GET', undefined, accessToken('viewer'));
    return response.body;
  }
  async function waitForSiteLock(): Promise<boolean> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const result = await pool.query<{ blocked: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
         AND wait_event_type = 'Lock' AND query ILIKE '%select%sites%for%update%') AS blocked`,
      );
      if (result.rows[0].blocked) return true;
      // PostgreSQL lock scheduling uses the real database clock.
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return false;
  }
  return {
    pool, origin, provinceCode, siteCode, deletedSiteCode, siteId, speciesCodes, users,
    request, requestText, accessToken, signedToken, expiredToken, create, todayAndDates,
    validSurvey, resetSurveys, status, waitForSiteLock,
    async cleanup() {
      if (siteId) {
        await pool.query('DELETE FROM survey_species WHERE survey_id IN (SELECT id FROM surveys WHERE site_id = $1)', [siteId]);
        await pool.query('DELETE FROM surveys WHERE site_id = $1', [siteId]);
      }
      if (createdSiteCodes.length) await pool.query('DELETE FROM sites WHERE code = ANY($1::text[])', [createdSiteCodes]);
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [Object.values(users)]);
      if (createdProvinceCode) await pool.query('DELETE FROM provinces WHERE code = $1', [createdProvinceCode]);
      if (createdSpeciesCodes.length) await pool.query('DELETE FROM species WHERE code = ANY($1::text[])', [createdSpeciesCodes]);
      await server.close();
    },
  };
}
export let pool: SurveyFixture['pool'];
export let origin: SurveyFixture['origin'];
export let provinceCode: SurveyFixture['provinceCode'];
export let siteCode: SurveyFixture['siteCode'];
export let deletedSiteCode: SurveyFixture['deletedSiteCode'];
export let siteId: SurveyFixture['siteId'];
export let speciesCodes: SurveyFixture['speciesCodes'];
export let users: SurveyFixture['users'];
export let request: SurveyFixture['request'];
export let requestText: SurveyFixture['requestText'];
export let accessToken: SurveyFixture['accessToken'];
export let signedToken: SurveyFixture['signedToken'];
export let expiredToken: SurveyFixture['expiredToken'];
export let create: SurveyFixture['create'];
export let todayAndDates: SurveyFixture['todayAndDates'];
export let validSurvey: SurveyFixture['validSurvey'];
export let resetSurveys: SurveyFixture['resetSurveys'];
export let status: SurveyFixture['status'];
export let waitForSiteLock: SurveyFixture['waitForSiteLock'];
let fixture: SurveyFixture | undefined;

beforeAll(async () => {
  if (!process.env.IMPORT_TEST_DATABASE_URL) return;
  fixture = await createSurveyFixture();
  ({
    pool, origin, provinceCode, siteCode, deletedSiteCode, siteId, speciesCodes, users,
    request, requestText, accessToken, signedToken, expiredToken, create, todayAndDates,
    validSurvey, resetSurveys, status, waitForSiteLock,
  } = fixture);
});

afterAll(async () => {
  await fixture?.cleanup();
});
