import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  retries: 0,
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
      command: 'node src/index.js',
      cwd: '../backend',
      port: 5000,
      timeout: 30_000,
      reuseExistingServer: !!process.env.CI,
      env: {
        ...process.env,
        NODE_ENV: process.env.CI ? 'test' : 'development',
      },
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
