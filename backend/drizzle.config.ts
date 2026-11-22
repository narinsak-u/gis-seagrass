import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  // shortcut: hand-written SQL has no snapshots, add a baseline snapshot before using drizzle-kit generate.
  schema: './src/database/schema/index.ts',
  out: './src/database/migrations',
});
