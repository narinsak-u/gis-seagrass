import { sql } from 'drizzle-orm';
import { surveySpecies, surveys } from '../../platform/database';

export const SURVEY_PROJECTION = {
  id: sql<string>`${surveys.id}::text`,
  lon: sql<number>`ST_X(${surveys.geom})::float8`,
  lat: sql<number>`ST_Y(${surveys.geom})::float8`,
  surveyed_on: surveys.surveyedOn,
  cover_percent: sql<number>`${surveys.coverPercent}::float8`,
  note: surveys.note,
  species: sql<string[]>`COALESCE(array_agg(${surveySpecies.speciesCode} ORDER BY ${surveySpecies.speciesCode}) FILTER (WHERE ${surveySpecies.speciesCode} IS NOT NULL), ARRAY[]::text[])`,
};
