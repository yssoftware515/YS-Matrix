import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  retries: 0,
  // Serial execution only. The specs share one mutable backend/test DB and
  // several of them sell the SAME demo inventory items / reuse the same
  // customer phone — parallel workers race and the loser's write silently
  // fails (then a success-toast assertion times out). Determinism over
  // speed here; 9 specs still finish well inside CI limits.
  workers: 1,
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results.json' }],
  ],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
  webServer: [
    {
      command:
        "node -e \"require('./src/config/env').loadTestEnv();" +
        "process.env.NODE_ENV='development';" +
        "require('./src/index')\"",
      cwd: '../backend',
      port: 5000,
      timeout: 30_000,
      reuseExistingServer: !!process.env.CI,
    },
    {
      command: 'npx next start -p 3000',
      cwd: '.',
      port: 3000,
      timeout: 30_000,
      reuseExistingServer: true,
    },
  ],
});
