import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './artifacts/playwright-live',
  fullyParallel: false,
  retries: 0,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:49172',
    colorScheme: 'dark',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command:
      'npm run build && ' +
      'concurrently -k ' +
      '"node packages/hub/dist/index.js --udp-port 49171 --http-port 49172 --static apps/browser/dist --quiet" ' +
      '"node packages/hub/dist/index.js --udp-port 49173 --http-port 49174 --quiet"',
    url: 'http://127.0.0.1:49172/health',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
