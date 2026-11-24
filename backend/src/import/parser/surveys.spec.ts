import { expect, test } from 'vitest';
import { parseSurveysCsv } from './surveys';

const header = 'survey_ref,site_code,lon,lat,surveyed_on,cover_percent,species';

test('survey CSV parser handles quoted UTF-8 fields, validates headers, and preserves record positions', () => {
  const parsed = parseSurveysCsv(`${header}\r\nref-1,site,100,10,2026-01-01,0,"สาหร่าย, ""แดง"""\r\nref-2,site,100,10,2026-01-01,100,"A|B"`);
  expect(parsed[0].row).toBe(2);
  expect(parsed[0].values.species).toBe('สาหร่าย, "แดง"');
  expect(parsed[1].row).toBe(3);
  const multiline = parseSurveysCsv(`${header}\nref-3,site,100,10,2026-01-01,0,"A\nB"`);
  expect(multiline[0].row).toBe(3);
  expect(() => parseSurveysCsv(`${header}\nx,y`)).toThrow(/Invalid CSV|malformed records/);
  expect(() => parseSurveysCsv('survey_ref,site_code\nx,y')).toThrow(/required headers/);
  expect(() => parseSurveysCsv(`${header}\n"unfinished`)).toThrow(/Invalid CSV/);
});
