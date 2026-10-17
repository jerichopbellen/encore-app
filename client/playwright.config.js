import { defineConfig } from '@playwright/test'
import process from 'node:process'
import { validateE2eDatabaseTarget } from './e2e/support/databaseSafety.cjs'

// Validate the explicit local test target before Playwright starts the backend.
validateE2eDatabaseTarget()

const testEnvironment = {
  ...process.env,
  NODE_ENV: 'test',
  PORT: '5000',
  FRONTEND_ORIGIN: 'http://127.0.0.1:5173',
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: './test-results',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    browserName: 'chromium',
    screenshot: 'only-on-failure',
    // Authentication request bodies contain passwords; keep traces disabled so
    // they cannot be saved in a trace network archive on a failed test.
    trace: 'off',
    video: 'off',
  },
  webServer: [
    {
      command: 'npm start',
      cwd: '../server',
      url: 'http://127.0.0.1:5000/api/ready',
      reuseExistingServer: false,
      timeout: 60_000,
      env: testEnvironment,
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 5173 --strictPort',
      cwd: '.',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: false,
      timeout: 60_000,
      env: testEnvironment,
    },
  ],
})
