import { defineConfig, devices } from '@playwright/test';

// Set PW_CHROMIUM_PATH to use an already-installed Chromium instead of `npx playwright install chromium`.
const executablePath = process.env.PW_CHROMIUM_PATH;
const launchOptions = executablePath ? { launchOptions: { executablePath } } : {};

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    locale: 'en-GB',
    timezoneId: 'Asia/Ulaanbaatar',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 }, ...launchOptions },
    },
    {
      name: 'phone',
      use: { ...devices['Pixel 7'], ...launchOptions },
    },
  ],
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
});
