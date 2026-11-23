import { bigint, boolean, check, customType, date, index, integer, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const multipolygon = customType<{ data: string; driverData: string }>({
  dataType: () => 'geometry(MultiPolygon,4326)',
});
const point = customType<{ data: string; driverData: string }>({
  dataType: () => 'geometry(Point,4326)',
});
const timestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps(),
}, (table) => [check('users_role_check', sql`${table.role} IN ('viewer', 'editor', 'admin')`)]);

export const provinces = pgTable('provinces', {
  code: varchar('code', { length: 2 }).primaryKey(),
  nameTh: text('name_th').notNull(),
  geom: multipolygon('geom').notNull(),
}, (table) => [index('idx_provinces_geom').using('gist', table.geom)]);

export const species = pgTable('species', {
  code: text('code').primaryKey(),
  nameTh: text('name_th').notNull(),
  nameSci: text('name_sci').notNull(),
});

export const sites = pgTable('sites', {
  id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  provinceCode: varchar('province_code', { length: 2 }).notNull().references(() => provinces.code, { onDelete: 'restrict' }),
  geom: multipolygon('geom').notNull(),
  areaRai: numeric('area_rai', { precision: 14, scale: 2 }).notNull(),
  version: integer('version').notNull().default(1),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'restrict' }),
  ...timestamps(),
  deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
}, (table) => [
  check('sites_version_check', sql`${table.version} > 0`),
  uniqueIndex('uq_sites_code').on(table.code),
  index('idx_sites_geom').using('gist', table.geom),
]);

export const surveys = pgTable('surveys', {
  id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
  siteId: bigint('site_id', { mode: 'bigint' }).notNull().references(() => sites.id, { onDelete: 'restrict' }),
  surveyRef: text('survey_ref'),
  geom: point('geom').notNull(),
  surveyedOn: date('surveyed_on', { mode: 'string' }).notNull(),
  coverPercent: numeric('cover_percent', { precision: 5, scale: 2 }).notNull(),
  note: text('note'),
  photoKey: text('photo_key'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'restrict' }),
  ...timestamps(),
}, (table) => [
  check('surveys_cover_percent_check', sql`${table.coverPercent} BETWEEN 0 AND 100`),
  uniqueIndex('uq_surveys_ref').on(table.surveyRef).where(sql`${table.surveyRef} IS NOT NULL`),
  index('idx_surveys_geom').using('gist', table.geom),
  index('idx_surveys_site_date').on(table.siteId, table.surveyedOn.desc(), table.id.desc()),
]);
export const surveySpecies = pgTable('survey_species', {
  surveyId: bigint('survey_id', { mode: 'bigint' }).notNull().references(() => surveys.id, { onDelete: 'restrict' }),
  speciesCode: text('species_code').notNull().references(() => species.code, { onDelete: 'restrict' }),
}, (table) => [primaryKey({ columns: [table.surveyId, table.speciesCode] })]);
