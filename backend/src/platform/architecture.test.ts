import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, type Dirent } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import * as ts from 'typescript';
import { test } from 'node:test';

const sourceRoot = resolve(process.cwd(), 'src');
const featureModules = ['auth', 'sites', 'surveys', 'site-survey-workflows', 'import'] as const;
const moduleFiles = {
  auth: 'auth.module.ts',
  sites: 'sites.module.ts',
  surveys: 'surveys.module.ts',
  'site-survey-workflows': 'site-survey.module.ts',
  import: undefined,
} as const;
const requiredLayers = {
  auth: ['domain', 'application', 'infrastructure', 'presentation'],
  sites: ['domain', 'application', 'infrastructure', 'presentation'],
  surveys: ['domain', 'application', 'infrastructure', 'presentation'],
  'site-survey-workflows': ['application', 'infrastructure'],
  import: ['parser', 'application', 'infrastructure'],
} as const;
const retiredLegacySubfolders = new Set<string>([
  'http',
  'dto',
  'contracts',
  'use-cases',
  'repositories',
  'transactions',
  'security',
]);

function subdirectories(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true }) as Dirent[];
  return entries.flatMap((entry) => {
    if (!entry.isDirectory()) return [];
    const path = join(directory, entry.name);
    return [path, ...subdirectories(path)];
  });
}

function sourceFiles(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true }) as Dirent[];
  return entries.flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

function importsFrom(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const imports: string[] = [];
  for (const statement of source.statements) {
    if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))
      && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      imports.push(statement.moduleSpecifier.text);
    }
  }
  return imports;
}

function owningModule(root: string, path: string): string | undefined {
  const segment = relative(root, path).split(sep)[0];
  return featureModules.includes(segment as typeof featureModules[number]) ? segment : undefined;
}
function parsedSource(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
}

function hasConfiguredDatabaseImport(file: string): boolean {
  const source = parsedSource(file);
  let found = false;
  const visit = (node: ts.Node) => {
    if (ts.isMethodDeclaration(node) && node.name.getText(source) === 'register' && node.parameters[0]) {
      const parameter = node.parameters[0].name;
      if (ts.isIdentifier(parameter) && node.body) {
        const inspect = (child: ts.Node) => {
          if (ts.isReturnStatement(child) && child.expression && ts.isObjectLiteralExpression(child.expression)) {
            const imports = child.expression.properties.find((property) =>
              ts.isPropertyAssignment(property) && property.name.getText(source) === 'imports');
            if (imports && ts.isPropertyAssignment(imports) && ts.isArrayLiteralExpression(imports.initializer)
              && imports.initializer.elements.some((element) =>
                ts.isIdentifier(element) && element.text === parameter.text)) found = true;
          }
          ts.forEachChild(child, inspect);
        };
        ts.forEachChild(node.body, inspect);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function appModuleDatabaseDependencies(root: string): {
  configured: ts.Identifier | undefined;
  configuredCount: number;
  registrations: Map<string, (readonly ts.Expression[])[]>;
} {
  const source = parsedSource(join(root, 'app.module.ts'));
  let configured: ts.Identifier | undefined;
  let configuredCount = 0;
  const registrations = new Map<string, (readonly ts.Expression[])[]>();
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'register') {
      const target = node.expression.expression;
      if (ts.isIdentifier(target) && target.text === 'DatabaseModule') {
        configuredCount++;
        const parent = node.parent;
        if (ts.isVariableDeclaration(parent) && parent.initializer === node && ts.isIdentifier(parent.name)) {
          configured = parent.name;
        }
      } else if (ts.isIdentifier(target)) {
        const calls = registrations.get(target.text) ?? [];
        calls.push(node.arguments);
        registrations.set(target.text, calls);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { configured, configuredCount, registrations };
}

function usesConfiguredDatabase(args: readonly ts.Expression[], configured: ts.Identifier): boolean {
  const databaseModule = args[0];
  return databaseModule !== undefined && ts.isIdentifier(databaseModule) && databaseModule.text === configured.text;
}


function assertApprovedPhysicalLayout(root: string): void {
  for (const moduleName of featureModules) {
    const moduleRoot = join(root, moduleName);
    const activeLayers: readonly string[] = requiredLayers[moduleName];
    for (const layer of activeLayers) {
      assert.ok(existsSync(join(moduleRoot, layer)), `${moduleName} is missing ${layer}/`);
    }

    for (const dir of subdirectories(moduleRoot)) {
      const dirParts = relative(moduleRoot, dir).split(sep);
      const retiredFolder = dirParts.find((part) => retiredLegacySubfolders.has(part));
      assert.ok(!retiredFolder, `${relative(root, dir)} must not use retired legacy folder ${retiredFolder}/`);
      if (dirParts.length === 1) {
        assert.ok(activeLayers.includes(dirParts[0]), `${relative(root, dir)} must be an approved layer`);
      } else {
        assert.ok(!dirParts.slice(1).some((part) => activeLayers.includes(part)),
          `${relative(root, dir)} must not nest a module layer`);
      }
    }

    const moduleFile = moduleFiles[moduleName];
    const allowedRootFiles = new Set([
      'index.ts',
      ...(moduleName === 'import' ? ['run.ts'] : [moduleFile!]),
    ]);
    if (moduleFile) {
      assert.ok(existsSync(join(moduleRoot, moduleFile)), `${moduleName} is missing its root module`);
    }
    for (const file of sourceFiles(moduleRoot)) {
      const relativePath = relative(moduleRoot, file);
      const pathParts = relativePath.split(sep);
      if (file.endsWith('.test.ts')) {
        assert.equal(pathParts.length, 1, `${relative(root, file)} must be at its module root`);
        continue;
      }
      const layer = pathParts[0];
      assert.ok(activeLayers.includes(layer)
        || (pathParts.length === 1 && allowedRootFiles.has(relativePath)),
      `${relative(root, file)} must live in an approved layer`);
      assert.ok(!pathParts.slice(1).some((part) => activeLayers.includes(part)),
        `${relative(root, file)} must not nest a module layer`);
    }
    const nestedModules = sourceFiles(moduleRoot).filter((file) => file.endsWith('.module.ts')
      && relative(moduleRoot, file).split(sep).length > 1);
    assert.deepEqual(nestedModules, [], `${moduleName} must define Nest modules only at its root`);
  }

  const platformRoot = join(root, 'platform');
  for (const layer of ['database', 'errors', 'health', 'http']) {
    assert.ok(existsSync(join(platformRoot, layer)), `platform is missing ${layer}/`);
  }
  for (const misplaced of ['database', 'domain', 'errors', 'health']) {
    assert.ok(!existsSync(join(root, misplaced)), `src/${misplaced}/ must not contain platform/shared code`);
  }
  assert.ok(!existsSync(join(root, 'import', 'domain')), 'Import parsers must live in parser/');
  const geospatialRoot = join(root, 'shared', 'geospatial');
  assert.ok(existsSync(join(geospatialRoot, 'domain')), 'shared geospatial rules must live in shared/geospatial/domain/');
  for (const file of sourceFiles(geospatialRoot)) {
    assert.equal(relative(geospatialRoot, file).split(sep)[0], 'domain',
      `${relative(root, file)} must live in shared/geospatial/domain/`);
  }
  for (const moduleName of featureModules) {
    const barrel = join(root, moduleName, 'index.ts');
    if (!existsSync(barrel)) continue;
    for (const specifier of importsFrom(barrel)) {
      assert.ok(!/(^|\/)infrastructure(?:\/|$)/.test(specifier), `${moduleName}/index.ts exposes infrastructure`);
    }
  }
}

function assertInnerLayerIndependence(root: string): void {
  const forbiddenPackage = /^(?:@nestjs\/|express(?:\/|$)|http(?:\/|$)|drizzle-orm(?:\/|$)|pg(?:\/|$)|node:http$)/;
  for (const file of sourceFiles(root)) {
    if (file.endsWith('.test.ts')) continue;
    const parts = relative(root, file).split(sep);
    const layer = parts.find((part) => part === 'application' || part === 'domain');
    if (!layer) continue;
    for (const specifier of importsFrom(file)) {
      assert.ok(!forbiddenPackage.test(specifier), `${relative(root, file)} imports forbidden ${specifier}`);
      assert.ok(!/(^|\/)platform\/database(?:\/|$)/.test(specifier), `${relative(root, file)} imports platform database`);
      assert.ok(!/(^|\/)(presentation|http|infrastructure)(\/|$)/.test(specifier), `${relative(root, file)} imports an outer layer`);
      if (layer === 'domain') {
        assert.ok(!/(^|\/)application(\/|$)/.test(specifier), `${relative(root, file)} imports application code`);
      }
    }
  }
}

function assertCrossModuleExports(root: string): void {
  for (const file of sourceFiles(root)) {
    if (file.endsWith('.test.ts')) continue;
    const sourceModule = owningModule(root, file);
    if (!sourceModule) continue;
    for (const specifier of importsFrom(file)) {
      if (!specifier.startsWith('.')) continue;
      const target = resolve(dirname(file), specifier);
      const targetParts = relative(root, target).split(sep);
      const targetModule = targetParts[0];
      if (!featureModules.includes(targetModule as typeof featureModules[number]) || targetModule === sourceModule) continue;
      const publicPath = targetParts.slice(1);
      const sourceParts = relative(root, file).split(sep);
      const isRootExport = publicPath.length === 0 && existsSync(join(target, 'index.ts'));
      const moduleFile = moduleFiles[targetModule as keyof typeof moduleFiles];
      const isModuleExport = publicPath.length === 1 && moduleFile?.replace(/\.ts$/, '') === publicPath[0];
      const isInfrastructureAdapterImport = publicPath[0] === 'infrastructure';
      const isTransactionAdapterExport = targetModule === 'site-survey-workflows'
        && publicPath.length === 2
        && publicPath[0] === 'infrastructure'
        && publicPath[1] === 'drizzle-transaction'
        && ['sites', 'surveys'].includes(sourceModule)
        && sourceParts[1] === 'infrastructure';
      if (isInfrastructureAdapterImport && !isTransactionAdapterExport) {
        const isCompositionRoot = (sourceModule === 'site-survey-workflows' && sourceParts[1] === 'site-survey.module.ts')
          || (sourceModule === 'import' && sourceParts[1] === 'infrastructure');
        assert.ok(isCompositionRoot, `${relative(root, file)} may not depend on another feature's infrastructure`);
      }
      assert.ok(isRootExport || isModuleExport || isInfrastructureAdapterImport || isTransactionAdapterExport,
        `${relative(root, file)} imports private ${targetModule} path: ${specifier}`);
    }
  }
}

function assertDatabaseComposition(root: string): void {
  const consumers = [
    'auth/auth.module.ts',
    'sites/sites.module.ts',
    'surveys/surveys.module.ts',
    'site-survey-workflows/site-survey.module.ts',
    'platform/platform.module.ts',
  ];
  for (const path of consumers) {
    assert.equal(hasConfiguredDatabaseImport(join(root, path)), true,
      `${path} must import its configured database module into the Nest module`);
  }

  const databaseModuleTarget = join(root, 'platform', 'database', 'database.module');
  const databaseModuleImporters = sourceFiles(root)
    .filter((file) => importsFrom(file).some((specifier) =>
      specifier.startsWith('.') && resolve(dirname(file), specifier) === databaseModuleTarget))
    .map((file) => relative(root, file));
  assert.deepEqual(databaseModuleImporters, ['app.module.ts'],
    'only AppModule may configure the database module');

  const { configured, configuredCount, registrations } = appModuleDatabaseDependencies(root);
  assert.equal(configuredCount, 1, 'AppModule must configure the database provider exactly once');
  assert.ok(configured, 'AppModule must retain the configured database module instance');
  for (const moduleName of ['PlatformModule', 'AuthModule', 'SiteSurveyModule', 'SitesModule', 'SurveysModule']) {
    const calls = registrations.get(moduleName) ?? [];
    assert.equal(calls.length, 1, `AppModule must register ${moduleName} exactly once`);
    assert.ok(usesConfiguredDatabase(calls[0], configured),
      `AppModule must pass the configured database module to ${moduleName}`);
  }
}

function withFixtureTree(files: Record<string, string>, run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'seagrass-arch-'));
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const fullPath = join(root, relativePath);
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, content, 'utf8');
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function minimalFlatBackendFixture(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    'auth/auth.module.ts': 'export class AuthModule {}\n',
    'auth/domain/actor.ts': 'export type Actor = string;\n',
    'auth/application/auth.service.ts': 'export class AuthService {}\n',
    'auth/application/auth.repository.ts': 'export interface AuthRepository {}\n',
    'auth/application/auth-token.ts': 'export const verifyToken = () => true;\n',
    'auth/infrastructure/drizzle-auth.repository.ts': 'export class DrizzleAuthRepository {}\n',
    'auth/presentation/auth.controller.ts': 'export class AuthController {}\n',
    'auth/presentation/auth.dto.ts': 'export class LoginDto {}\n',
    'sites/index.ts': "export { deriveSiteStatus } from './domain/site-status.rules';\n",
    'sites/sites.module.ts': 'export class SitesModule {}\n',
    'sites/domain/site-status.rules.ts': 'export const deriveSiteStatus = () => null;\n',
    'sites/application/site-queries.ts': 'export class SiteQueries {}\n',
    'sites/application/site-read.repository.ts': 'export interface SiteReadRepository {}\n',
    'sites/infrastructure/drizzle-site-read.repository.ts': 'export class DrizzleSiteReadRepository {}\n',
    'sites/presentation/sites.controller.ts': 'export class SitesController {}\n',
    'sites/presentation/sites.dto.ts': 'export class SiteDto {}\n',
    'surveys/index.ts': "export { isStrictCalendarDate } from './domain/calendar-date';\n",
    'surveys/surveys.module.ts': 'export class SurveysModule {}\n',
    'surveys/domain/calendar-date.ts': 'export const isStrictCalendarDate = () => true;\n',
    'surveys/application/survey-commands.ts': 'export class SurveyCommands {}\n',
    'surveys/infrastructure/drizzle-survey-write.repository.ts': 'export class DrizzleSurveyWriteRepository {}\n',
    'surveys/presentation/surveys.controller.ts': 'export class SurveysController {}\n',
    'surveys/presentation/surveys.dto.ts': 'export class SurveyDto {}\n',
    'site-survey-workflows/index.ts': "export { SiteSurveyCoordinator } from './application/site-survey-coordinator';\n",
    'site-survey-workflows/site-survey.module.ts': 'export class SiteSurveyModule {}\n',
    'site-survey-workflows/application/site-survey-coordinator.ts': 'export class SiteSurveyCoordinator {}\n',
    'site-survey-workflows/application/transaction-runner.port.ts': 'export interface SiteSurveyTransactionRunner {}\n',
    'site-survey-workflows/infrastructure/drizzle-transaction-runner.ts': 'export class DrizzleTransactionRunner {}\n',
    'site-survey-workflows/infrastructure/drizzle-transaction.ts': 'export const unwrapTransaction = () => null;\n',
    'import/run.ts': 'export const run = () => {};\n',
    'import/parser/sites.ts': 'export const parseSites = () => [];\n',
    'import/application/import-sites.ts': 'export const importSiteFeatures = () => [];\n',
    'import/infrastructure/site-survey-operations.ts': 'export const createOps = () => ({});\n',
    'platform/database/index.ts': 'export const db = null;\n',
    'platform/errors/error.filter.ts': 'export class ErrorFilter {}\n',
    'platform/health/health.controller.ts': 'export class HealthController {}\n',
    'platform/http/index.ts': 'export const envelope = () => ({});\n',
    'shared/geospatial/domain/geometry.ts': 'export const valid = () => true;\n',
    ...overrides,
  };
}

test('backend production files use the approved physical modules and layers', () => {
  assertApprovedPhysicalLayout(sourceRoot);
});

test('flat layout rules require presentation and reject legacy http layer', () => {
  withFixtureTree(minimalFlatBackendFixture(), (root) => {
    assertApprovedPhysicalLayout(root);
  });

  const legacyHttpOnly = minimalFlatBackendFixture({
    'sites/http/sites.controller.ts': 'export class LegacySitesController {}\n',
  });
  delete legacyHttpOnly['sites/presentation/sites.controller.ts'];
  delete legacyHttpOnly['sites/presentation/sites.dto.ts'];
  withFixtureTree(legacyHttpOnly, (root) => {
    assert.throws(() => assertApprovedPhysicalLayout(root), /sites is missing presentation\//);
  });

  withFixtureTree(minimalFlatBackendFixture({
    'sites/http/sites.controller.ts': 'export class LegacySitesController {}\n',
  }), (root) => {
    assert.throws(() => assertApprovedPhysicalLayout(root), /retired legacy folder http\//);
  });

  const withoutSitesPresentation = minimalFlatBackendFixture();
  delete withoutSitesPresentation['sites/presentation/sites.controller.ts'];
  delete withoutSitesPresentation['sites/presentation/sites.dto.ts'];
  withFixtureTree(withoutSitesPresentation, (root) => {
    assert.throws(() => assertApprovedPhysicalLayout(root), /sites is missing presentation\//);
  });

  withFixtureTree(minimalFlatBackendFixture({
    'sites/index.ts': "export { DrizzleSiteReadRepository } from './infrastructure/drizzle-site-read.repository';\n",
  }), (root) => {
    assert.throws(() => assertApprovedPhysicalLayout(root), /exposes infrastructure/);
  });
});

test('flat layout rules forbid retired legacy subfolders while allowing legitimate non-retired subfolders', () => {
  const retiredCases: Array<[string, string]> = [
    ['auth/http/auth.controller.ts', 'http'],
    ['sites/presentation/http/adapter.ts', 'http'],
    ['sites/presentation/dto/sites.dto.ts', 'dto'],
    ['sites/application/contracts/site-read.repository.ts', 'contracts'],
    ['surveys/application/use-cases/survey-commands.ts', 'use-cases'],
    ['import/application/use-cases/import-sites.ts', 'use-cases'],
    ['sites/infrastructure/repositories/drizzle-site-read.repository.ts', 'repositories'],
    ['site-survey-workflows/infrastructure/transactions/drizzle-transaction.ts', 'transactions'],
    ['auth/application/security/auth-token.ts', 'security'],
    ['sites/application/filtering/contracts/filter.port.ts', 'contracts'],
  ];
  for (const [filePath, folder] of retiredCases) {
    withFixtureTree(minimalFlatBackendFixture({ [filePath]: 'export const value = true;\n' }), (root) => {
      assert.throws(
        () => assertApprovedPhysicalLayout(root),
        new RegExp(`retired legacy folder ${folder}/`),
        `expected ${filePath} to fail for retired folder ${folder}/`,
      );
    });
  }

  // Empty retired directory inside a flattened feature layer must also fail.
  withFixtureTree(minimalFlatBackendFixture(), (root) => {
    mkdirSync(join(root, 'sites/presentation/dto'), { recursive: true });
    assert.throws(() => assertApprovedPhysicalLayout(root), /retired legacy folder dto\//);
  });

  // Legitimate non-retired subfolders and optional filenames must be allowed.
  withFixtureTree(minimalFlatBackendFixture({
    'sites/domain/geometry/bounds.ts': 'export const inBounds = () => true;\n',
    'sites/application/filtering/site-filters.ts': 'export const buildFilter = () => ({});\n',
    'sites/infrastructure/mappers/site-row.mapper.ts': 'export const mapRow = () => ({});\n',
    'sites/presentation/serializers/site-response.ts': 'export const serialize = () => ({});\n',
    'auth/application/policies/role-matrix.ts': 'export const canAccess = () => true;\n',
    'site-survey-workflows/infrastructure/locking/site-lock.ts': 'export const lockKey = 1;\n',
    'import/parser/geojson/feature.ts': 'export const parseFeature = () => ({});\n',
  }), (root) => {
    assertApprovedPhysicalLayout(root);
  });
});

test('application and domain imports stay independent of HTTP and persistence frameworks', () => {
  assertInnerLayerIndependence(sourceRoot);
});

test('inner-layer dependency rules block presentation, http, infrastructure, and framework imports', () => {
  withFixtureTree(minimalFlatBackendFixture({
    'sites/application/site-queries.ts': "import { deriveSiteStatus } from '../domain/site-status.rules';\nexport { deriveSiteStatus };\n",
  }), (root) => {
    assertInnerLayerIndependence(root);
  });

  const forbiddenCases: Array<[string, string, RegExp]> = [
    ['sites/domain/site-status.rules.ts', "import { SiteDto } from '../presentation/sites.dto';\n", /imports an outer layer/],
    ['sites/application/site-queries.ts', "import { SiteDto } from '../presentation/sites.dto';\n", /imports an outer layer/],
    ['sites/application/site-queries.ts', "import { SitesController } from '../http/sites.controller';\n", /imports an outer layer/],
    ['sites/application/site-queries.ts', "import { DrizzleSiteReadRepository } from '../infrastructure/drizzle-site-read.repository';\n", /imports an outer layer/],
    ['sites/domain/site-status.rules.ts', "import { SiteQueries } from '../application/site-queries';\n", /imports application code/],
    ['sites/application/site-queries.ts', "import { Injectable } from '@nestjs/common';\n", /imports forbidden @nestjs\/common/],
    ['sites/application/site-queries.ts', "import express from 'express';\n", /imports forbidden express/],
    ['sites/application/site-queries.ts', "import { sql } from 'drizzle-orm';\n", /imports forbidden drizzle-orm/],
    ['sites/application/site-queries.ts', "import { Pool } from 'pg';\n", /imports forbidden pg/],
    ['sites/application/site-queries.ts', "import { db } from '../../platform/database';\n", /imports platform database/],
  ];
  for (const [filePath, content, pattern] of forbiddenCases) {
    withFixtureTree(minimalFlatBackendFixture({ [filePath]: content }), (root) => {
      assert.throws(() => assertInnerLayerIndependence(root), pattern);
    });
  }
});

test('cross-module imports use public module exports', () => {
  assertCrossModuleExports(sourceRoot);
});

test('cross-module export rules require flattened transaction adapter path while preserving boundaries', () => {
  withFixtureTree(minimalFlatBackendFixture({
    'sites/infrastructure/drizzle-site-write.repository.ts':
      "import { unwrapTransaction } from '../../site-survey-workflows/infrastructure/drizzle-transaction';\nexport { unwrapTransaction };\n",
    'surveys/infrastructure/drizzle-survey-write.repository.ts':
      "import { unwrapTransaction } from '../../site-survey-workflows/infrastructure/drizzle-transaction';\nexport { unwrapTransaction };\n",
    'site-survey-workflows/site-survey.module.ts':
      "import { DrizzleSiteReadRepository } from '../sites/infrastructure/drizzle-site-read.repository';\nexport { DrizzleSiteReadRepository };\n",
    'import/infrastructure/site-survey-operations.ts':
      "import { DrizzleSurveyWriteRepository } from '../../surveys/infrastructure/drizzle-survey-write.repository';\nexport { DrizzleSurveyWriteRepository };\n",
    'sites/presentation/sites.controller.ts':
      "import { AuthModule } from '../../auth/auth.module';\nimport { SiteSurveyCoordinator } from '../../site-survey-workflows';\nexport { AuthModule, SiteSurveyCoordinator };\n",
  }), (root) => {
    assertCrossModuleExports(root);
  });

  const forbiddenCrossModuleCases: Array<[string, string, RegExp]> = [
    [
      'surveys/infrastructure/drizzle-survey-write.repository.ts',
      "import { unwrapTransaction } from '../../site-survey-workflows/infrastructure/transactions/drizzle-transaction';\n",
      /may not depend on another feature's infrastructure/,
    ],
    [
      'sites/infrastructure/drizzle-site-write.repository.ts',
      "import { unwrapTransaction } from '../../site-survey-workflows/infrastructure/transactions/drizzle-transaction';\n",
      /may not depend on another feature's infrastructure/,
    ],
    [
      'sites/infrastructure/drizzle-site-write.repository.ts',
      "import { DrizzleTransactionRunner } from '../../site-survey-workflows/infrastructure/drizzle-transaction-runner';\n",
      /may not depend on another feature's infrastructure/,
    ],
    [
      'sites/application/site-queries.ts',
      "import { unwrapTransaction } from '../../site-survey-workflows/infrastructure/drizzle-transaction';\n",
      /may not depend on another feature's infrastructure/,
    ],
    [
      'auth/infrastructure/drizzle-auth.repository.ts',
      "import { unwrapTransaction } from '../../site-survey-workflows/infrastructure/drizzle-transaction';\n",
      /may not depend on another feature's infrastructure/,
    ],
    [
      'sites/presentation/sites.controller.ts',
      "import { AuthController } from '../../auth/presentation/auth.controller';\n",
      /imports private auth path/,
    ],
  ];
  for (const [filePath, content, pattern] of forbiddenCrossModuleCases) {
    withFixtureTree(minimalFlatBackendFixture({ [filePath]: content }), (root) => {
      assert.throws(() => assertCrossModuleExports(root), pattern);
    });
  }
});

test('database access is explicit in Nest consumers and composed once by AppModule', () => {
  assertDatabaseComposition(sourceRoot);
});
