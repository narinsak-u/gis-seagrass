import { randomUUID } from 'node:crypto';
import { signAccessToken } from '../../auth/application/auth-token';
import { request as httpRequest } from 'node:http';
import { expect, test } from 'vitest';
import {
  accessToken, create, expiredToken, origin, pool, request, resetSurveys, siteCode, signedToken,
  siteId, speciesCodes, users, validSurvey,
} from './surveys.spec-helper';

const integration = process.env.IMPORT_TEST_DATABASE_URL ? test : test.skip;
integration('Swagger documents Survey operations, payloads, and error responses', async () => {
  const response = await fetch(`${origin}/docs-json`);
  expect(response.status).toBe(200);
  type Schema = {
    $ref?: string;
    required?: string[];
    minProperties?: number;
    anyOf?: Schema[];
    not?: Schema;
    properties?: Record<string, Schema>;
    items?: Schema;
    nullable?: boolean;
  };
  type Operation = {
    description?: string;
    requestBody?: { content?: Record<string, { schema?: Schema }> };
    security?: Array<Record<string, string[]>>;
    responses?: Record<string, { content?: Record<string, { schema?: Schema }> }>;
  };
  const document = await response.json() as {
    paths: Record<string, Record<string, Operation>>;
    components?: { schemas?: Record<string, Schema>; securitySchemes?: Record<string, { type?: string; scheme?: string; bearerFormat?: string }> };
  };
  const post = document.paths['/sites/{code}/surveys'].post;
  const patch = document.paths['/surveys/{id}'].patch;
  const remove = document.paths['/surveys/{id}'].delete;
  const list = document.paths['/sites/{code}/surveys'].get;
  expect(post && patch && remove && list).toBeTruthy();
  expect(document.components?.securitySchemes?.['access-token']).toStrictEqual({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });
  expect(post.security).toStrictEqual([{ 'access-token': [] }]);
  expect(post.description ?? '').toMatch(/admin/);
  expect(patch.security).toStrictEqual([{ 'access-token': [] }]);
  expect(patch.description ?? '').toMatch(/admin/);
  for (const [operation, statuses] of [
    [list, ['200', '400', '401', '403', '404', '500']],
    [post, ['201', '400', '401', '403', '404', '422', '500']],
    [patch, ['200', '400', '401', '403', '404', '422', '500']],
    [remove, ['204', '400', '401', '403', '404', '500']],
  ] as const) {
    for (const code of statuses) expect(operation.responses?.[code], `Missing documented response ${code}`).toBeTruthy();
  }
  const resolveSchema = (schema?: Schema) => schema?.$ref
    ? document.components?.schemas?.[schema.$ref.split('/').at(-1)!]
    : schema;
  const requestSchema = (operation: Operation) => resolveSchema(operation.requestBody?.content?.['application/json']?.schema);
  const responseSchema = (operation: Operation, code: string) =>
    resolveSchema(operation.responses?.[code]?.content?.['application/json']?.schema);
  for (const operation of [list, post, patch, remove]) {
    expect(Object.keys(responseSchema(operation, '500')?.properties ?? {})).toStrictEqual(['error']);
    expect(Object.keys(responseSchema(operation, '500')?.properties?.error?.properties ?? {}).sort()).toStrictEqual(['code', 'details', 'message']);
  }
  const postSchema = requestSchema(post);
  const patchSchema = requestSchema(patch);
  expect((postSchema?.required ?? []).slice().sort()).toStrictEqual(['cover_percent', 'lat', 'lon', 'species', 'surveyed_on']);
  expect(Object.keys(postSchema?.properties ?? {}).sort()).toStrictEqual(['cover_percent', 'lat', 'lon', 'note', 'species', 'surveyed_on']);
  expect(Object.keys(patchSchema?.properties ?? {}).sort()).toStrictEqual(['cover_percent', 'lat', 'lon', 'note', 'species', 'surveyed_on']);
  expect(patchSchema?.minProperties).toBe(1);
  expect(patchSchema?.anyOf?.[0]?.required).toStrictEqual(['lon', 'lat']);
  expect(patchSchema?.anyOf?.[1]?.not?.anyOf?.map((schema) => schema.required)).toStrictEqual([['lon'], ['lat']]);
  const postResponse = responseSchema(post, '201');
  const patchResponse = responseSchema(patch, '200');
  const listResponse = responseSchema(list, '200');
  expect(Object.keys(postResponse?.properties ?? {}).sort()).toStrictEqual(['cover_percent', 'id', 'lat', 'lon', 'note', 'siteStatus', 'species', 'surveyed_on']);
  expect(Object.keys(patchResponse?.properties ?? {}).sort()).toStrictEqual(['cover_percent', 'id', 'lat', 'lon', 'note', 'siteStatus', 'species', 'surveyed_on']);
  expect(Object.keys(listResponse?.properties ?? {}).sort()).toStrictEqual(['items', 'page', 'total']);
  const listedSurvey = resolveSchema(listResponse?.properties?.items?.items);
  expect(Object.keys(listedSurvey?.properties ?? {}).sort()).toStrictEqual(['cover_percent', 'created_by', 'id', 'lat', 'lon', 'note', 'species', 'surveyed_on']);
  expect(listedSurvey?.properties?.created_by?.nullable).toBe(true);
});

integration('GET /sites/:code/surveys paginates deterministic list shapes and rejects invalid queries', async () => {
  await resetSurveys();
  const older = await pool!.query<{ id: string }>(
    `INSERT INTO surveys (site_id,geom,surveyed_on,cover_percent)
     VALUES ($1, ST_SetSRID(ST_MakePoint(100.150025,10.150025),4326), '2025-01-01', 10) RETURNING id::text`,
    [siteId],
  );
  const firstTie = await create(await validSurvey({ surveyed_on: '2025-02-01', cover_percent: 20 }));
  const secondTie = await create(await validSurvey({ surveyed_on: '2025-02-01', cover_percent: 30 }));
  expect(firstTie.body.siteStatus).toBe('poor');
  expect(secondTie.body.siteStatus).toBe('fair');
  await pool!.query("UPDATE surveys SET created_by = $1, photo_key = 'private-survey-secret' WHERE id = $2", [users.editor, secondTie.body.id]);
  const page = await request(`/sites/${siteCode}/surveys`, 'GET', undefined, accessToken('viewer'));
  expect(page.response.status).toBe(200);
  expect(Object.keys(page.body).sort()).toStrictEqual(['items', 'page', 'total']);
  expect(page.body.page).toBe(1);
  expect(page.body.total).toBe(3);
  const items = page.body.items as Array<Record<string, unknown>>;
  expect(items.map(({ id }) => id)).toStrictEqual([secondTie.body.id, firstTie.body.id, older.rows[0].id]);
  expect(Object.keys(items[0]).sort()).toStrictEqual(['cover_percent', 'created_by', 'id', 'lat', 'lon', 'note', 'species', 'surveyed_on']);
  expect(items[0].created_by).toBe(users.editor);
  expect(items[0].photo_key).toBe(undefined);
  expect(items[0].siteStatus).toBe(undefined);
  expect(items[2].created_by).toBe(null);
  expect(items[0].species).toStrictEqual([speciesCodes[0]]);
  const secondPage = await request(`/sites/${siteCode}/surveys?page=2&pageSize=2`, 'GET', undefined, accessToken('editor'));
  expect((secondPage.body.items as Array<Record<string, unknown>>).map(({ id }) => id)).toStrictEqual([older.rows[0].id]);
  const emptyPage = await request(`/sites/${siteCode}/surveys?page=4&pageSize=1`, 'GET', undefined, accessToken('admin'));
  expect(emptyPage.body.items).toStrictEqual([]);
  const maxPage = await request(`/sites/${siteCode}/surveys?pageSize=100`, 'GET', undefined, accessToken('viewer'));
  expect((maxPage.body.items as unknown[]).length).toBe(3);
  for (const query of ['page=0', 'page=1.2', 'pageSize=0', 'pageSize=101', 'pageSize=abc', 'other=x']) {
    const invalid = await request(`/sites/${siteCode}/surveys?${query}`, 'GET', undefined, accessToken('viewer'));
    expect(invalid.response.status).toBe(400);
    expect(((invalid.body.error as Record<string, unknown>).code)).toBe('VALIDATION_ERROR');
    expect(Object.keys(invalid.body.error as object).sort()).toStrictEqual(['code', 'details', 'message']);
  }
});

integration('GET /sites/:code/surveys authenticates active current users before Site lookup', async () => {
  const path = `/sites/MISSING-${siteCode}/surveys`;
  for (const token of [undefined, 'not-a-token', expiredToken()]) {
    const denied = await request(path, 'GET', undefined, token);
    expect(denied.response.status).toBe(401);
    expect(denied.body.error).toStrictEqual({ code: 'UNAUTHORIZED', message: 'Authentication required', details: {} });
  }
  const invalidQuery = await request(`/sites/MISSING-${siteCode}/surveys?page=0`);
  expect(invalidQuery.response.status).toBe(401);
  const malformed = await new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
    const req = httpRequest(new URL(path, origin), { method: 'GET', headers: { 'content-type': 'application/json', 'content-length': '1' } }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    req.on('error', reject);
    req.end('{');
  });
  expect(malformed.status).toBe(400);
  expect(JSON.parse(malformed.body).error).toStrictEqual({ code: 'VALIDATION_ERROR', message: 'Validation failed', details: {} });
  const invalidSignature = `${accessToken('viewer').slice(0, -1)}x`;
  expect((await request(path, 'GET', undefined, invalidSignature)).response.status).toBe(401);
  const now = Math.floor(Date.now() / 1000);
  expect((await request(path, 'GET', undefined, signedToken('not-a-uuid', now, now + 60))).response.status).toBe(401);
  const validMissing = await request(path, 'GET', undefined, accessToken('viewer'));
  expect(validMissing.response.status).toBe(404);
  await pool!.query('UPDATE users SET is_active = false WHERE id = $1', [users.viewer]);
  const inactive = await request(path, 'GET', undefined, accessToken('viewer'));
  expect(inactive.response.status).toBe(401);
  await pool!.query('UPDATE users SET is_active = true WHERE id = $1', [users.viewer]);
  const deletedUser = randomUUID();
  await pool!.query('INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, $4)', [deletedUser, `${randomUUID()}@example.test`, 'unused', 'viewer']);
  const deletedToken = signAccessToken(deletedUser);
  await pool!.query('DELETE FROM users WHERE id = $1', [deletedUser]);
  expect((await request(path, 'GET', undefined, deletedToken)).response.status).toBe(401);
  for (const role of ['viewer', 'editor', 'admin'] as const) {
    expect((await request(`/sites/${siteCode}/surveys`, 'GET', undefined, accessToken(role))).response.status).toBe(200);
  }
  expect((await request('/health')).response.status).toBe(200);
  expect((await request('/sites')).response.status).toBe(200);
  expect((await fetch(`${origin}/docs`)).status).toBe(200);
  expect((await request('/sites.geojson?bbox=99,9,101,11')).response.status).toBe(200);
  expect((await request(`/sites/${siteCode}`)).response.status).toBe(200);
  expect((await fetch(`${origin}/docs-json`)).status).toBe(200);
});


