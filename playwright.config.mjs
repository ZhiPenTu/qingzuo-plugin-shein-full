import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '*.spec.mjs',
  workers: 1,
  timeout: 240000,
  expect: { timeout: 60000 },
  reporter: 'list',
  outputDir: './output/e2e',
  use: { trace: 'retain-on-failure' }
});
