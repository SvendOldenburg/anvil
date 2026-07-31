// Dev-only. Serves the static app and runs tests/ against a mocked PocketBase.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:8123',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'python -m http.server 8123',
    url: 'http://127.0.0.1:8123',
    reuseExistingServer: true,
    stdout: 'ignore',
  },
});
