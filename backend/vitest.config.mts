import { defineConfig } from 'vitest/config';
import ts from 'typescript';

export default defineConfig({
  plugins: [{
    name: 'nest-decorator-metadata',
    enforce: 'pre',
    transform(source, id) {
      if (!id.includes('/src/') || !id.endsWith('.ts')) return;
      const result = ts.transpileModule(source, {
        fileName: id,
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          esModuleInterop: true,
          sourceMap: true,
        },
      });
      return { code: result.outputText, map: result.sourceMapText };
    },
  }],
  test: {
    environment: 'node',
    isolate: true,
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 60_000,
    projects: [
      { test: { name: 'unit', include: ['tests/**/*.unit.spec.ts'] } },
      { test: { name: 'integration', include: ['tests/**/*.integration.spec.ts'] } },
    ],
  },
});
