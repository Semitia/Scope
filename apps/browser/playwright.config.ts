import { defineConfig } from '@playwright/test';

const externalBaseUrl = process.env.DEBUGSCOPE_BROWSER_URL;

export default defineConfig({
  testDir: './tests',
  outputDir: '../../artifacts/playwright',
  fullyParallel: false,
  retries: 0,
  reporter: 'line',
  use: {
    baseURL: externalBaseUrl ?? 'http://127.0.0.1:4712',
    colorScheme: 'dark',
    screenshot: 'only-on-failure',
  },
  webServer: externalBaseUrl ? undefined : {
    command: 'npm run dev',
    url: 'http://127.0.0.1:4712',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
