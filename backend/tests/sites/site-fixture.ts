import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Pool } from 'pg';
import { AppModule } from '../../src/app.module';
import { createDatabaseProvider, runMigrations } from '../../src/platform/database';

export interface SiteFixture {
  pool: Pool;
  origin: string;
  siteCodes: string[];
  provinceCodes: string[];
  createdSiteCodes: string[];
  surveyRefs: string[];
  siteToken: string;
  importSpeciesCode: string;
  postToken: string;
  users: Record<'viewer' | 'editor' | 'admin', string>;
  cleanup(): Promise<void>;
}

export async function createSiteFixture(): Promise<SiteFixture | undefined> {
  const testDatabaseUrl = process.env.IMPORT_TEST_DATABASE_URL;
  process.env.JWT_SECRET ??= 'isolated-integration-signing-secret-32-bytes';
  if (!testDatabaseUrl) return undefined;

  const url = new URL(testDatabaseUrl);
  process.env.PGHOST = url.hostname;
  process.env.PGPORT = url.port || '5432';
  process.env.PGUSER = decodeURIComponent(url.username);
  process.env.PGPASSWORD = decodeURIComponent(url.password);
  process.env.PGDATABASE = decodeURIComponent(url.pathname.slice(1));
  const database = createDatabaseProvider();
  await runMigrations(database);
  const pool = database.pool;
  let siteCodes: string[] = [];
  let provinceCodes: string[] = [];
  let siteToken = '';
  let importSpeciesCode = '';
  let postToken = '';
  do {
    const token = randomUUID().replaceAll('-', '').toUpperCase();
    provinceCodes = [token.slice(0, 2), token.slice(2, 4)];
    siteToken = token.slice(4, 12);
    importSpeciesCode = `PATCH-SPECIES-${token.slice(12, 20)}`;
    postToken = `POST-${token.slice(20, 24)}`;
    siteCodes = ['ALPHA', 'BETA', 'GAMMA', 'HISTORY'].map((name) => `${name}-${siteToken}`);
    const postCodes = ['POST', 'MULTI', 'TIE', 'BAD', 'TOUCH'].map((name) => `${name}-${postToken}`);
    if (provinceCodes[0] === provinceCodes[1]) continue;
    const existing = await pool.query(
      'SELECT 1 FROM provinces WHERE code = ANY($1::varchar[]) UNION ALL SELECT 1 FROM sites WHERE code = ANY($2::text[])',
      [provinceCodes, [...siteCodes, ...postCodes]],
    );
    if (!existing.rowCount) break;
  } while (true);
  await pool.query('INSERT INTO species (code,name_th,name_sci) VALUES ($1,$1,$1)', [importSpeciesCode]);
  await pool.query(
    `INSERT INTO provinces (code, name_th, geom) VALUES
      ($1, 'West', ST_Multi(ST_GeomFromText('POLYGON((100 10,101 10,101 11,100 11,100 10))',4326))),
      ($2, 'East', ST_Multi(ST_GeomFromText('POLYGON((101 10,102 10,102 11,101 11,101 10))',4326)))`,
    provinceCodes,
  );
  await pool.query(
    `INSERT INTO sites (code,name,province_code,geom,area_rai,deleted_at) VALUES
      ($1,'Zebra meadow',$2,ST_Multi(ST_GeomFromText('POLYGON((100.1 10.1,100.2 10.1,100.2 10.2,100.1 10.2,100.1 10.1))',4326)),1,NULL),
      ($3,'alpha lagoon',$4,ST_Multi(ST_GeomFromText('POLYGON((100.3 10.1,100.4 10.1,100.4 10.2,100.3 10.2,100.3 10.1))',4326)),2,NULL),
      ($5,'Another zone',$6,ST_Multi(ST_GeomFromText('POLYGON((101.1 10.1,101.2 10.1,101.2 10.2,101.1 10.2,101.1 10.1))',4326)),3,NULL),
      ($7,'Retired site',$2,ST_Multi(ST_GeomFromText('POLYGON((100.5 10.1,100.6 10.1,100.6 10.2,100.5 10.2,100.5 10.1))',4326)),1,now())`,
    [siteCodes[0], provinceCodes[0], siteCodes[1], provinceCodes[0], siteCodes[2], provinceCodes[1], siteCodes[3]],
  );
  const users = { viewer: randomUUID(), editor: randomUUID(), admin: randomUUID() };
  await pool.query(
    'INSERT INTO users (id, email, password_hash, role) VALUES ($1,$2,$3,$4),($5,$6,$7,$8),($9,$10,$11,$12)',
    [users.viewer, `${users.viewer}@example.test`, 'unused', 'viewer',
      users.editor, `${users.editor}@example.test`, 'unused', 'editor',
      users.admin, `${users.admin}@example.test`, 'unused', 'admin'],
  );
  const app = await NestFactory.create(AppModule.register(database), { logger: false });
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  if (!address || typeof address !== 'object') throw new Error('HTTP server did not bind');
  const createdSiteCodes: string[] = [];
  const surveyRefs: string[] = [];
  return {
    pool, origin: `http://127.0.0.1:${address.port}`,
    siteCodes, provinceCodes, createdSiteCodes, surveyRefs, siteToken, importSpeciesCode, postToken, users,
    async cleanup() {
      if (surveyRefs.length) {
        await pool.query('DELETE FROM survey_species WHERE survey_id IN (SELECT id FROM surveys WHERE survey_ref = ANY($1::text[]))', [surveyRefs]);
        await pool.query('DELETE FROM surveys WHERE survey_ref = ANY($1::text[])', [surveyRefs]);
      }
      await pool.query('DELETE FROM sites WHERE code = ANY($1::text[])', [[...siteCodes, ...createdSiteCodes]]);
      await pool.query('DELETE FROM provinces WHERE code = ANY($1::varchar[])', [provinceCodes]);
      await pool.query('DELETE FROM species WHERE code = $1', [importSpeciesCode]);
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [Object.values(users)]);
      await app.close();
    },
  };
}
