import { expect, test } from 'vitest';
import {
  accessToken, create, pool, request, resetSurveys, siteCode, siteId, validSurvey, waitForSiteLock,
} from './surveys.spec-helper';

const integration = process.env.IMPORT_TEST_DATABASE_URL ? test : test.skip;
integration('Survey create and Site geometry edit serialize without violating distance invariant', async () => {
  await resetSurveys();
  const coordinator = await pool!.connect();
  let committed = false;
  try {
    await coordinator.query('BEGIN');
    await coordinator.query('SELECT id FROM sites WHERE code = $1 FOR UPDATE', [siteCode]);
    const write = create(await validSurvey());
    const blocked = await waitForSiteLock();
    expect(blocked, 'Survey POST should wait for the Site row lock').toBeTruthy();
    const edit = request(`/sites/${siteCode}`, 'PATCH', {
      version: 1,
      geometry: { type: 'Polygon', coordinates: [[[100.152,10.152],[100.1522,10.152],[100.1522,10.1522],[100.152,10.1522],[100.152,10.152]]] },
    }, accessToken('admin'));
    await coordinator.query('COMMIT');
    committed = true;
    const [edited, result] = await Promise.all([edit, write]);
    if (result.response.status === 201) {
      expect(edited.response.status).toBe(409);
      const invariant = await pool!.query<{ violations: number }>(
        `SELECT count(*)::int AS violations FROM surveys v JOIN sites s ON s.id = v.site_id
         WHERE v.site_id = $1 AND NOT ST_DWithin(s.geom::geography,v.geom::geography,50)`, [siteId],
      );
      expect(invariant.rows[0].violations).toBe(0);
    } else {
      expect(result.response.status).toBe(422);
      expect((result.body.error as Record<string, unknown>).code).toBe('OUTSIDE_SITE');
      expect(edited.response.status).toBe(200);
      expect((await pool!.query('SELECT count(*)::int AS count FROM surveys WHERE site_id = $1', [siteId])).rows[0].count).toBe(0);
    }
  } finally {
    if (!committed) await coordinator.query('ROLLBACK');
    await pool!.query(
      `UPDATE sites SET geom = ST_Multi(ST_GeomFromText('POLYGON((100.15 10.15,100.15005 10.15,100.15005 10.15005,100.15 10.15005,100.15 10.15))',4326)),
         version = 1 WHERE id = $1`, [siteId],
    );
    coordinator.release();
  }
});

integration('Survey location PATCH and Site geometry edit cannot commit incompatible positions', async () => {
  await resetSurveys();
  const initial = await create(await validSurvey());
  const point = await pool!.query<{ lon: number; lat: number }>(
    `SELECT ST_X(p)::float8 AS lon, ST_Y(p)::float8 AS lat FROM (
       SELECT ST_Project(ST_SetSRID(ST_MakePoint(100.15005,10.150025),4326)::geography,40,pi()/2)::geometry AS p
     ) q`,
  );
  const coordinator = await pool!.connect();
  let committed = false;
  try {
    await coordinator.query('BEGIN');
    await coordinator.query('SELECT id FROM sites WHERE code = $1 FOR UPDATE', [siteCode]);
    const location = request(`/surveys/${initial.body.id}`, 'PATCH', point.rows[0], accessToken('admin'));
    expect(await waitForSiteLock(), 'Survey PATCH should wait for the Site row lock').toBeTruthy();
    const geometry = request(`/sites/${siteCode}`, 'PATCH', {
      version: 1,
      geometry: { type: 'Polygon', coordinates: [[[100.1496,10.15],[100.14965,10.15],[100.14965,10.15005],[100.1496,10.15005],[100.1496,10.15]]] },
    }, accessToken('admin'));
    await coordinator.query('COMMIT');
    committed = true;
    const [moved, edited] = await Promise.all([location, geometry]);
    if (moved.response.status === 200) {
      expect(edited.response.status).toBe(409);
      expect((edited.body.error as Record<string, unknown>).code).toBe('SURVEYS_OUTSIDE');
    } else {
      expect(moved.response.status).toBe(422);
      expect((moved.body.error as Record<string, unknown>).code).toBe('OUTSIDE_SITE');
      expect(edited.response.status).toBe(200);
    }
    const invariant = await pool!.query<{ violations: number }>(
      `SELECT count(*)::int AS violations FROM surveys v JOIN sites s ON s.id = v.site_id
       WHERE v.site_id = $1 AND NOT ST_DWithin(s.geom::geography,v.geom::geography,50)`, [siteId],
    );
    expect(invariant.rows[0].violations).toBe(0);
  } finally {
    if (!committed) await coordinator.query('ROLLBACK');
    await pool!.query(
      `UPDATE sites SET geom = ST_Multi(ST_GeomFromText('POLYGON((100.15 10.15,100.15005 10.15,100.15005 10.15005,100.15 10.15005,100.15 10.15))',4326)),
         version = 1 WHERE id = $1`, [siteId],
    );
    coordinator.release();
  }
});

integration('Site delete racing Survey create cannot commit both delete and a linked Survey', async () => {
  await resetSurveys();
  const coordinator = await pool!.connect();
  let committed = false;
  try {
    await coordinator.query('BEGIN');
    await coordinator.query('SELECT id FROM sites WHERE code = $1 FOR UPDATE', [siteCode]);
    const write = create(await validSurvey());
    const blocked = await waitForSiteLock();
    expect(blocked, 'Survey POST should wait for the Site row lock').toBeTruthy();
    const deletion = request(`/sites/${siteCode}`, 'DELETE', undefined, accessToken('admin'));
    await coordinator.query('COMMIT');
    committed = true;
    const [deleted, result] = await Promise.all([deletion, write]);
    if (result.response.status === 201) {
      expect(deleted.response.status).toBe(409);
      expect((deleted.body.error as Record<string, unknown>).code).toBe('SITE_HAS_SURVEYS');
      expect((await pool!.query('SELECT deleted_at FROM sites WHERE id = $1', [siteId])).rows[0].deleted_at).toBe(null);
      const invariant = await pool!.query<{ distance: number }>(
        `SELECT ST_Distance(s.geom::geography,v.geom::geography) AS distance
           FROM surveys v JOIN sites s ON s.id = v.site_id WHERE v.id = $1`, [result.body.id],
      );
      expect(invariant.rows[0].distance <= 50).toBeTruthy();
    } else {
      expect(result.response.status).toBe(404);
      expect((result.body.error as Record<string, unknown>).code).toBe('SITE_NOT_FOUND');
      expect(deleted.response.status).toBe(204);
      expect((await pool!.query<{ deleted_at: Date | null }>('SELECT deleted_at FROM sites WHERE id = $1', [siteId])).rows[0].deleted_at).toBeTruthy();
      expect((await pool!.query('SELECT count(*)::int AS count FROM surveys WHERE site_id = $1', [siteId])).rows[0].count).toBe(0);
    }
  } finally {
    if (!committed) await coordinator.query('ROLLBACK');
    await resetSurveys();
    await pool!.query('UPDATE sites SET deleted_at = NULL, version = 1 WHERE id = $1', [siteId]);
    coordinator.release();
  }
});
