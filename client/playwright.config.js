import { defineConfig } from '@playwright/test'
import process from 'node:process'
import { validateE2eDatabaseTarget } from './e2e/support/databaseSafety.cjs'
import { relaxedRateLimitEnvironment } from '../tests/helpers/rateLimitTestEnvironment.cjs'

// Validate the explicit local test target before Playwright starts the backend.
validateE2eDatabaseTarget()

const testEnvironment = {
  ...process.env,
  NODE_ENV: 'test',
  PORT: '5000',
  FRONTEND_ORIGIN: 'http://127.0.0.1:5173',
  // The booking scenarios use simulated checkout; a developer's server/.env may select
  // Stripe, so pin the provider for the test backend only (dotenv never overrides it).
  PAYMENT_PROVIDER: 'simulated',
  // The scenarios register and sign in many accounts from one address; raise the rate limits
  // for this test backend only. Limiter behavior is covered by the rateLimit* unit tests.
  ...relaxedRateLimitEnvironment(),
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
