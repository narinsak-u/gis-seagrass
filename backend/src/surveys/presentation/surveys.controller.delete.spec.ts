import { expect, test } from 'vitest';
import {
  accessToken, create, pool, request, resetSurveys, siteCode, speciesCodes, validSurvey,
} from './surveys.spec-helper';

const integration = process.env.IMPORT_TEST_DATABASE_URL ? test : test.skip;
integration('DELETE /surveys/:id authorizes before ID validation or lookup', async () => {
  for (const token of [undefined, 'invalid']) {
    const unauthenticated = await request('/surveys/not-a-number', 'DELETE', undefined, token);
    expect(unauthenticated.response.status).toBe(401);
    expect((unauthenticated.body.error as Record<string, unknown>).code).toBe('UNAUTHORIZED');
  }
  for (const role of ['viewer', 'editor'] as const) {
    const forbidden = await request('/surveys/not-a-number', 'DELETE', undefined, accessToken(role));
    expect(forbidden.response.status).toBe(403);
    expect((forbidden.body.error as Record<string, unknown>).code).toBe('FORBIDDEN');
  }
  const malformed = await request('/surveys/not-a-number', 'DELETE', undefined, accessToken('admin'));
  expect(malformed.response.status).toBe(400);
  expect((malformed.body.error as Record<string, unknown>).code).toBe('VALIDATION_ERROR');
  const missing = await request('/surveys/9223372036854775807', 'DELETE', undefined, accessToken('admin'));
  expect(missing.response.status).toBe(404);
  expect((missing.body.error as Record<string, unknown>).code).toBe('SURVEY_NOT_FOUND');
});

integration('DELETE hard-deletes Survey and species links, recomputes Site status, and preserves the shared error envelope', async () => {
  await resetSurveys();
  const created = await create(await validSurvey({ species: [...speciesCodes] }));
  const id = created.body.id as string;
  const populatedSite = await request(`/sites/${siteCode}`);
  expect(((populatedSite.body.properties as Record<string, unknown>)).siteStatus).toBe('fair');
  const deleted = await request(`/surveys/${id}`, 'DELETE', undefined, accessToken('admin'));
  expect(deleted.response.status).toBe(204);
  expect(await deleted.response.text()).toBe('');
  expect((await pool!.query('SELECT 1 FROM surveys WHERE id = $1', [id])).rowCount).toBe(0);
  expect((await pool!.query('SELECT 1 FROM survey_species WHERE survey_id = $1', [id])).rowCount).toBe(0);
  const emptySite = await request(`/sites/${siteCode}`);
  expect(((emptySite.body.properties as Record<string, unknown>)).siteStatus).toBe('no_data');
  const unknown = await request(`/surveys/${id}`, 'DELETE', undefined, accessToken('admin'));
  expect(unknown.response.status).toBe(404);
  expect((unknown.body.error as Record<string, unknown>).code).toBe('SURVEY_NOT_FOUND');
});
