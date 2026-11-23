import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, type Dirent } from 'node:fs';
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
const layeredModules = {
  auth: ['http', 'application', 'domain', 'infrastructure'],
  sites: ['http', 'application', 'domain', 'infrastructure'],
  surveys: ['http', 'application', 'domain', 'infrastructure'],
  'site-survey-workflows': ['application', 'infrastructure'],
  import: ['parser', 'application', 'infrastructure'],
} as const;

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

function owningModule(path: string): string | undefined {
  const segment = relative(sourceRoot, path).split(sep)[0];
  return featureModules.includes(segment as typeof featureModules[number]) ? segment : undefined;
}

test('backend production files use the approved physical modules and layers', () => {
  for (const moduleName of featureModules) {
    const moduleRoot = join(sourceRoot, moduleName);
    for (const layer of layeredModules[moduleName]) {
      assert.ok(existsSync(join(moduleRoot, layer)), `${moduleName} is missing ${layer}/`);
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
        assert.equal(pathParts.length, 1, `${relative(sourceRoot, file)} must be at its module root`);
        continue;
      }
      const layer = pathParts[0];
      assert.ok((layeredModules[moduleName] as readonly string[]).includes(layer)
        || (pathParts.length === 1 && allowedRootFiles.has(relativePath)),
      `${relative(sourceRoot, file)} must live in an approved layer`);
      assert.ok(!pathParts.slice(1).some((part) => (layeredModules[moduleName] as readonly string[]).includes(part)),
        `${relative(sourceRoot, file)} must not nest a module layer`);
      if (layer === 'application') {
        const allowedFolders = moduleName === 'auth' ? ['contracts', 'use-cases', 'security'] : ['contracts', 'use-cases'];
        assert.ok(allowedFolders.includes(pathParts[1]), `${relative(sourceRoot, file)} must live in an approved application folder`);
      }
      if (layer === 'http' && file.endsWith('.dto.ts')) {
        assert.equal(pathParts[1], 'dto', `${relative(sourceRoot, file)} DTOs must live in http/dto/`);
      }
      if (layer === 'infrastructure' && /repository/i.test(file)) {
        assert.equal(pathParts[1], 'repositories', `${relative(sourceRoot, file)} repositories must live in infrastructure/repositories/`);
      }
    }
    const nestedModules = sourceFiles(moduleRoot).filter((file) => file.endsWith('.module.ts')
      && relative(moduleRoot, file).split(sep).length > 1);
    assert.deepEqual(nestedModules, [], `${moduleName} must define Nest modules only at its root`);
  }

  const platformRoot = join(sourceRoot, 'platform');
  for (const layer of ['database', 'errors', 'health', 'http']) {
    assert.ok(existsSync(join(platformRoot, layer)), `platform is missing ${layer}/`);
  }
  for (const misplaced of ['database', 'domain', 'errors', 'health']) {
    assert.ok(!existsSync(join(sourceRoot, misplaced)), `src/${misplaced}/ must not contain platform/shared code`);
  }
  assert.ok(!existsSync(join(sourceRoot, 'import', 'domain')), 'Import parsers must live in parser/');
  const geospatialRoot = join(sourceRoot, 'shared', 'geospatial');
  assert.ok(existsSync(join(geospatialRoot, 'domain')), 'shared geospatial rules must live in shared/geospatial/domain/');
  for (const file of sourceFiles(geospatialRoot)) {
    assert.equal(relative(geospatialRoot, file).split(sep)[0], 'domain',
      `${relative(sourceRoot, file)} must live in shared/geospatial/domain/`);
  }
  for (const moduleName of featureModules) {
    const barrel = join(sourceRoot, moduleName, 'index.ts');
    if (!existsSync(barrel)) continue;
    for (const specifier of importsFrom(barrel)) {
      assert.ok(!/(^|\/)infrastructure(?:\/|$)/.test(specifier), `${moduleName}/index.ts exposes infrastructure`);
    }
  }
});
test('application and domain imports stay independent of HTTP and persistence frameworks', () => {
  const forbiddenPackage = /^(?:@nestjs\/|express(?:\/|$)|http(?:\/|$)|drizzle-orm(?:\/|$)|pg(?:\/|$)|node:http$)/;
  for (const file of sourceFiles(sourceRoot)) {
    if (file.endsWith('.test.ts')) continue;
    const parts = relative(sourceRoot, file).split(sep);
    const layer = parts.find((part) => part === 'application' || part === 'domain');
    if (!layer) continue;
    for (const specifier of importsFrom(file)) {
      assert.ok(!forbiddenPackage.test(specifier), `${relative(sourceRoot, file)} imports forbidden ${specifier}`);
      assert.ok(!/(^|\/)platform\/database(?:\/|$)/.test(specifier), `${relative(sourceRoot, file)} imports platform database`);
      assert.ok(!/(^|\/)(http|infrastructure)(\/|$)/.test(specifier), `${relative(sourceRoot, file)} imports an outer layer`);
      if (layer === 'domain') {
        assert.ok(!/(^|\/)application(\/|$)/.test(specifier), `${relative(sourceRoot, file)} imports application code`);
      }
    }
  }
});

test('cross-module imports use public module exports', () => {
  for (const file of sourceFiles(sourceRoot)) {
    if (file.endsWith('.test.ts')) continue;
    const sourceModule = owningModule(file);
    if (!sourceModule) continue;
    for (const specifier of importsFrom(file)) {
      if (!specifier.startsWith('.')) continue;
      const target = resolve(dirname(file), specifier);
      const targetParts = relative(sourceRoot, target).split(sep);
      const targetModule = targetParts[0];
      if (!featureModules.includes(targetModule as typeof featureModules[number]) || targetModule === sourceModule) continue;
      const publicPath = targetParts.slice(1);
      const sourceParts = relative(sourceRoot, file).split(sep);
      const isRootExport = publicPath.length === 0 && existsSync(join(target, 'index.ts'));
      const moduleFile = moduleFiles[targetModule as keyof typeof moduleFiles];
      const isModuleExport = publicPath.length === 1 && moduleFile?.replace(/\.ts$/, '') === publicPath[0];
      const isInfrastructureAdapterImport = publicPath[0] === 'infrastructure';
      const isTransactionAdapterExport = targetModule === 'site-survey-workflows' && publicPath.length === 3
        && publicPath[0] === 'infrastructure' && publicPath[1] === 'transactions' && publicPath[2] === 'drizzle-transaction'
        && ['sites', 'surveys'].includes(sourceModule) && sourceParts[1] === 'infrastructure';
      if (isInfrastructureAdapterImport && !isTransactionAdapterExport) {
        const isCompositionRoot = (sourceModule === 'site-survey-workflows' && sourceParts[1] === 'site-survey.module.ts')
          || (sourceModule === 'import' && sourceParts[1] === 'infrastructure');
        assert.ok(isCompositionRoot, `${relative(sourceRoot, file)} may not depend on another feature's infrastructure`);
      }
      assert.ok(isRootExport || isModuleExport || isInfrastructureAdapterImport || isTransactionAdapterExport,
        `${relative(sourceRoot, file)} imports private ${targetModule} path: ${specifier}`);
    }
  }
});
test('database access is explicit in Nest consumers and composed once by AppModule', () => {
  const consumers = [
    'auth/auth.module.ts',
    'sites/sites.module.ts',
    'surveys/surveys.module.ts',
    'site-survey-workflows/site-survey.module.ts',
  ];
  for (const path of consumers) {
    const source = readFileSync(join(sourceRoot, path), 'utf8');
    assert.match(source, /imports:\s*\[databaseModule\b/, `${path} must import the configured database module`);
  }

  const databaseModuleImporters = sourceFiles(sourceRoot)
    .filter((file) => importsFrom(file).includes('./platform/database/database.module') || importsFrom(file).includes('../platform/database/database.module'))
    .map((file) => relative(sourceRoot, file));
  assert.deepEqual(databaseModuleImporters, ['app.module.ts'],
    'only AppModule may configure the database module');

  const appModule = readFileSync(join(sourceRoot, 'app.module.ts'), 'utf8');
  assert.equal((appModule.match(/DatabaseModule\.register\(database\)/g) ?? []).length, 1,
    'AppModule must configure the database provider exactly once');
  for (const [moduleName, args] of [
    ['PlatformModule', 'databaseModule'],
    ['AuthModule', 'databaseModule'],
    ['SiteSurveyModule', 'databaseModule'],
    ['SitesModule', 'databaseModule, authModule, siteSurveyModule'],
    ['SurveysModule', 'databaseModule, authModule, siteSurveyModule'],
  ]) {
    assert.match(appModule, new RegExp(`${moduleName}\\.register\\(${args.replaceAll(', ', '\\s*,\\s*')}\\)`),
      `AppModule must compose ${moduleName} with approved dependencies`);
  }
});
