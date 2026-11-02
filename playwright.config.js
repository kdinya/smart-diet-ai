const { defineConfig, devices } = require('@playwright/test');

const port = Number(process.env.SMOKE_PORT || 4173);

module.exports = defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  timeout: 60_000,
  fullyParallel: true,
  workers: Number(process.env.PW_WORKERS || 2),
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: Boolean(process.env.CI),
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${port}`,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: `node tests/serve.js ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 15_000,
  },
});
