import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { createDatabaseProvider, type DatabaseProvider } from '../platform/database';
import { withImportAdvisoryLock } from './infrastructure/advisory-lock';
import { createSiteSurveyImportOperations } from './infrastructure/site-survey-operations';
import { parseProvinceCollection } from './parser/province';
import { importSiteFeatures } from './application/sites';
import { parseSiteCollection } from './parser/sites';
import { parseSpeciesArray } from './parser/species';
import { importProvinces, importSpecies } from './infrastructure/reference-data';
import { importSurveys } from './application/surveys';
import { parseSurveysCsv } from './parser/surveys';

export interface ImportSummary {
  provinces: { inserted: number; skipped_existing: number; rejected: number };
  species: { inserted: number; skipped_existing: number; rejected: number };
  sites: { inserted: number; skipped_existing: number; rejected: number };
  surveys: { inserted: number; skipped_existing: number; rejected: number };
}

function escapeCsvField(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function replaceReport(path: string, rows: Array<[string, number, string]>): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporaryPath = resolve(directory, `.import_report.csv.tmp-${randomUUID()}`);
  const contents = [['file', 'row', 'reason'], ...rows].map((row) => row.map(escapeCsvField).join(',')).join('\r\n') + '\r\n';
  try {
    await writeFile(temporaryPath, contents, { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export async function runImport(provider?: DatabaseProvider): Promise<ImportSummary> {
  const inputDir = resolve(process.env.SEED_DATA_DIR ?? 'seed-data');
  const provinceFeatures = parseProvinceCollection(await readFile(resolve(inputDir, 'provinces.geojson'), 'utf8'));
  const siteFeatures = parseSiteCollection(await readFile(resolve(inputDir, 'seagrass_sites.geojson'), 'utf8'));
  const surveyRecords = parseSurveysCsv(await readFile(resolve(inputDir, 'surveys.csv'), 'utf8'));
  const reportPath = resolve(process.env.IMPORT_REPORT_PATH ?? '../reports/import_report.csv');
  const ownsProvider = !provider;
  const database = provider ?? createDatabaseProvider();
  const pool = database.pool;
  const summary: ImportSummary = {
    provinces: { inserted: 0, skipped_existing: 0, rejected: 0 },
    species: { inserted: 0, skipped_existing: 0, rejected: 0 },
    sites: { inserted: 0, skipped_existing: 0, rejected: 0 },
    surveys: { inserted: 0, skipped_existing: 0, rejected: 0 },
  };
  const report: Array<[string, number, string]> = [];
  try {
    return await withImportAdvisoryLock(pool, async () => {
      const { coordinator, surveyWriter } = createSiteSurveyImportOperations(database.db);
      const provinces = await importProvinces(database.db, provinceFeatures);
      summary.provinces = provinces.summary;
      report.push(...provinces.rejections.map(({ row, reason }) => ['provinces.geojson', row, reason] as [string, number, string]));
      const speciesPath = resolve(process.env.SEED_DATA_DIR ?? 'seed-data', 'species.json');
      const species = await importSpecies(database.db, parseSpeciesArray(await readFile(speciesPath, 'utf8')));
      summary.species = species.summary;
      report.push(...species.rejections.map(({ row, reason }) => ['species.json', row, reason] as [string, number, string]));
      const siteResult = await importSiteFeatures(coordinator, siteFeatures);
      summary.sites = siteResult.summary;
      for (const rejection of siteResult.rejections) report.push(['seagrass_sites.geojson', rejection.row, rejection.reason]);
      const surveys = await importSurveys(surveyWriter, surveyRecords);
      summary.surveys = surveys.summary;
      report.push(...surveys.rejections.map(({ row, reason }) => ['surveys.csv', row, reason] as [string, number, string]));
      await replaceReport(reportPath, report);
      console.info('Import summary:', JSON.stringify(summary));
      return summary;
    });
  } finally {
    if (ownsProvider) await database.close();
  }
}

if (require.main === module) {
  void runImport().catch((error: unknown) => {
    console.error('Seed import failed:', error);
    process.exitCode = 1;
  });
}
