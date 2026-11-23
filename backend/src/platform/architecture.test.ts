import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, type Dirent } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import * as ts from 'typescript';
import { test } from 'node:test';

const sourceRoot = resolve(process.cwd(), 'src');
const featureModules = ['auth', 'sites', 'surveys', 'site-survey', 'import'] as const;
const layeredModules = {
  auth: ['http', 'application', 'domain', 'infrastructure'],
  sites: ['http', 'application', 'domain', 'infrastructure'],
  surveys: ['http', 'application', 'domain', 'infrastructure'],
  'site-survey': ['application', 'infrastructure'],
  import: ['domain', 'application', 'infrastructure'],
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

    const allowedRootFiles = new Set([
      'index.ts',
      `${moduleName}.module.ts`,
      'run.ts',
    ]);
    for (const file of sourceFiles(moduleRoot)) {
      const relativePath = relative(moduleRoot, file);
      if (!relativePath.includes(sep)) {
        const name = relativePath;
        if (name.endsWith('.test.ts') || allowedRootFiles.has(name)) continue;
        assert.fail(`${relative(sourceRoot, file)} must live in an approved layer`);
      }
    }
  }
  assert.ok(!existsSync(join(sourceRoot, 'domain')), 'the catch-all src/domain/ directory must not exist');
});

test('application and domain imports stay independent of HTTP and persistence frameworks', () => {
  const forbiddenPackage = /^(?:@nestjs\/|express(?:\/|$)|http(?:\/|$)|drizzle-orm(?:\/|$)|pg(?:\/|$)|node:http$)/;
  for (const file of sourceFiles(sourceRoot)) {
    if (file.endsWith('.test.ts')) continue;
    const parts = relative(sourceRoot, file).split(sep);
    const layer = parts[1];
    if (layer !== 'application' && layer !== 'domain') continue;
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
      const isRootExport = publicPath.length === 0 && existsSync(join(target, 'index.ts'));
      const isModuleExport = publicPath.length === 1 && publicPath[0] === `${targetModule}.module`;
      const isLayerExport = publicPath.length === 1 && existsSync(join(target, 'index.ts'));
      assert.ok(isRootExport || isModuleExport || isLayerExport,
        `${relative(sourceRoot, file)} imports private ${targetModule} path: ${specifier}`);
    }
  }
});
