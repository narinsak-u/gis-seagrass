import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, test } from 'vitest';

test('API process refuses startup without JWT_SECRET before accessing the database', () => {
  const { status, stderr, stdout } = spawnSync(process.execPath, [join(process.cwd(), 'dist/main.js')], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, JWT_SECRET: '' },
  });
  expect(status).toBe(1);
  expect(`${stderr}${stdout}`).toMatch(/JWT_SECRET must be configured/);
});
