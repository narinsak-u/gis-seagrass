import { expect, test } from 'vitest';
import {
  accessToken, create, origin, pool, request, resetSurveys, siteCode, siteId, speciesCodes,
  status, todayAndDates, users, validSurvey,
} from './surveys.spec-helper';

const integration = process.env.IMPORT_TEST_DATABASE_URL ? test : test.skip;
integration('POST and PATCH derive status from all latest-date Surveys and threshold means', async () => {
  await resetSurveys();
  const { today, yesterday } = await todayAndDates();
  expect((await status()).total).toBe(0);
  const thresholds = [[0, 'poor'], [24.99, 'poor'], [25, 'fair'], [49.99, 'fair'], [50, 'good'], [74.99, 'good'], [75, 'very_good'], [100, 'very_good']] as const;
  for (const [cover, expected] of thresholds) {
    await resetSurveys();
    const response = await create(await validSurvey({ surveyed_on: today, cover_percent: cover }));
    expect(response.body.siteStatus).toBe(expected);
  }
  await resetSurveys();
  const older = await create(await validSurvey({ surveyed_on: yesterday, cover_percent: 90 }));
  expect(older.body.siteStatus).toBe('very_good');
  const firstLatest = await create(await validSurvey({ surveyed_on: today, cover_percent: 20 }));
  expect(firstLatest.body.siteStatus).toBe('poor');
  const secondLatest = await create(await validSurvey({ surveyed_on: today, cover_percent: 80 }));
  expect(secondLatest.body.siteStatus).toBe('good');
  const updated = await request(`/surveys/${firstLatest.body.id}`, 'PATCH', { cover_percent: 40 }, accessToken('admin'));
  expect(updated.response.status).toBe(200);
  expect(updated.body.siteStatus).toBe('good');
  const removed = await request(`/surveys/${secondLatest.body.id}`, 'DELETE', undefined, accessToken('admin'));
  expect(removed.response.status).toBe(204);
  expect(await removed.response.text()).toBe('');
  const siteAfterDelete = await request(`/sites/${siteCode}`);
  expect((siteAfterDelete.body.properties as Record<string, unknown>).siteStatus).toBe('fair');
  const afterDelete = await request(`/surveys/${firstLatest.body.id}`, 'PATCH', { note: 'recomputed' }, accessToken('admin'));
  expect(afterDelete.body.siteStatus).toBe('fair');
  const remaining = await request(`/surveys/${firstLatest.body.id}`, 'PATCH', { surveyed_on: yesterday }, accessToken('admin'));
  expect(remaining.response.status).toBe(200);
  expect(remaining.body.siteStatus).toBe('good');
  const deleteLatest = await request(`/surveys/${older.body.id}`, 'DELETE', undefined, accessToken('admin'));
  expect(deleteLatest.response.status).toBe(204);
  expect((await status()).total).toBe(1);
  const deleteLast = await request(`/surveys/${firstLatest.body.id}`, 'DELETE', undefined, accessToken('admin'));
  expect(deleteLast.response.status).toBe(204);
  await resetSurveys();
  const empty = await status();
  expect(empty.total).toBe(0);
  const detail = await request(`/sites/${siteCode}`);
  expect((detail.body.properties as Record<string, unknown>).latest_survey).toBe(null);
});

integration('PATCH validates IDs and partial edits; replaces species only when supplied and clears note on null', async () => {
  await resetSurveys();
  const initial = await create(await validSurvey({ species: [...speciesCodes], note: 'keep me' }));
  const roundedPatch = await fetch(`${origin}/surveys/${initial.body.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken('admin')}` },
    body: '{"cover_percent":1.0000000000000001}',
  });
  expect(roundedPatch.status).toBe(400);
  expect(((await roundedPatch.json() as Record<string, unknown>).error as Record<string, unknown>).code).toBe('VALIDATION_ERROR');
  const unchangedCover = await pool!.query<{ cover_percent: string }>('SELECT cover_percent FROM surveys WHERE id = $1', [initial.body.id]);
  expect(unchangedCover.rows[0].cover_percent).toBe('40.00');
  expect((await request('/surveys/abc', 'PATCH', { note: 'x' })).response.status).toBe(401);
  expect((await request('/surveys/abc', 'PATCH', { note: 'x' }, 'not-a-token')).response.status).toBe(401);
  for (const role of ['viewer', 'editor'] as const) {
    const forbidden = await request('/surveys/abc', 'PATCH', { note: 'x' }, accessToken(role));
    expect(forbidden.response.status).toBe(403);
    expect((forbidden.body.error as Record<string, unknown>).code).toBe('FORBIDDEN');
  }
  for (const id of ['0', '-1', '01', '1.0', 'abc']) {
    const invalid = await request(`/surveys/${id}`, 'PATCH', { note: 'x' }, accessToken('admin'));
    expect(invalid.response.status).toBe(400);
    expect((invalid.body.error as Record<string, unknown>).code).toBe('VALIDATION_ERROR');
  }
  for (const id of ['0', '-1', '01', '1.0', 'abc']) {
    const invalid = await request(`/surveys/${id}`, 'DELETE', undefined, accessToken('admin'));
    expect(invalid.response.status).toBe(400);
    expect((invalid.body.error as Record<string, unknown>).code).toBe('VALIDATION_ERROR');
  }
  const unknown = await request('/surveys/999999999999999999', 'PATCH', { note: 'x' }, accessToken('admin'));
  expect(unknown.response.status).toBe(404);
  expect((unknown.body.error as Record<string, unknown>).code).toBe('SURVEY_NOT_FOUND');
  for (const body of [{}, { lon: 100.15 }, { lat: 10.15 }, { site_id: '2' }, { species: [`UNKNOWN-${siteCode}`] }]) {
    const invalid = await request(`/surveys/${initial.body.id}`, 'PATCH', body, accessToken('admin'));
    expect(invalid.response.status).toBe(400);
    expect((invalid.body.error as Record<string, unknown>).code).toBe('VALIDATION_ERROR');
  }
  const forged = await request(`/surveys/${initial.body.id}`, 'PATCH', {
    note: 'forged', created_by: users.viewer, updated_by: users.viewer, updated_at: '2000-01-01T00:00:00Z',
  }, accessToken('admin'));
  expect(forged.response.status).toBe(400);
  const unchanged = await request(`/surveys/${initial.body.id}`, 'PATCH', { cover_percent: 41 }, accessToken('admin'));
  expect(unchanged.response.status).toBe(200);
  expect(unchanged.body.note).toBe('keep me');
  expect((unchanged.body.species as string[]).sort()).toStrictEqual([...speciesCodes].sort());
  const beforeSpecies = await pool!.query<{ created_by: string | null }>('SELECT created_by FROM surveys WHERE id = $1', [initial.body.id]);
  await pool!.query("UPDATE surveys SET updated_at = '2000-01-01 00:00:00+00', updated_by = $2 WHERE id = $1", [initial.body.id, users.viewer]);
  const replaced = await request(`/surveys/${initial.body.id}`, 'PATCH', { species: [speciesCodes[1], speciesCodes[1]] }, accessToken('admin'));
  expect(replaced.body.species).toStrictEqual([speciesCodes[1]]);
  const audited = await pool!.query<{ created_by: string | null; updated_by: string | null; updated_at: Date }>(
    'SELECT created_by, updated_by, updated_at FROM surveys WHERE id = $1', [initial.body.id],
  );
  expect(audited.rows[0].created_by).toBe(beforeSpecies.rows[0].created_by);
  expect(audited.rows[0].updated_by).toBe(users.admin);
  expect(audited.rows[0].updated_at > new Date('2000-01-01T00:00:00Z')).toBeTruthy();
  const savedSpecies = await pool!.query<{ species_code: string }>(
    'SELECT species_code FROM survey_species WHERE survey_id = $1 ORDER BY species_code', [initial.body.id],
  );
  expect(savedSpecies.rows.map(({ species_code }) => species_code)).toStrictEqual([speciesCodes[1]]);
  const cleared = await request(`/surveys/${initial.body.id}`, 'PATCH', { note: null }, accessToken('admin'));
  const savedNote = await pool!.query<{ note: string | null }>('SELECT note FROM surveys WHERE id = $1', [initial.body.id]);
  expect(savedNote.rows[0].note).toBe(null);
  const newPosition = await pool!.query<{ lon: number; lat: number }>(
    `SELECT ST_X(p)::float8 AS lon, ST_Y(p)::float8 AS lat FROM (
       SELECT ST_Project(ST_SetSRID(ST_MakePoint(100.15005,10.150025),4326)::geography,20::double precision,pi()/2)::geometry AS p
     ) q`,
  );
  const loneCoordinate = await request(`/surveys/${initial.body.id}`, 'PATCH', { lon: newPosition.rows[0].lon }, accessToken('admin'));
  expect(loneCoordinate.response.status).toBe(400);
  const moved = await request(`/surveys/${initial.body.id}`, 'PATCH', newPosition.rows[0], accessToken('admin'));
  expect(moved.body.lon).toBe(newPosition.rows[0].lon);
  expect(moved.body.lat).toBe(newPosition.rows[0].lat);
});


