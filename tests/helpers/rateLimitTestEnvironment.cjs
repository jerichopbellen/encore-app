// Integration and E2E suites sign up and log in many accounts from one address (127.0.0.1) and
// reserve repeatedly, which would trip the production-sized rate limits and fail unrelated tests.
// This raises every limiter to its configurable maximum for those suites only. The limiters are
// still mounted and run; their behavior is verified by the dedicated unit tests (rateLimit*.test.cjs),
// which use their own small limits. Nothing here is read by production code or by deployments.
const { LIMIT_DEFINITIONS } = require('../../server/src/config/rateLimit')

const RELAXED_LIMIT = '100000'

function relaxedRateLimitEnvironment() {
  const environment = {}
  for (const { envName } of Object.values(LIMIT_DEFINITIONS)) {
    environment[`RATE_LIMIT_${envName}_MAX`] = RELAXED_LIMIT
  }
  return environment
}

module.exports = { relaxedRateLimitEnvironment, RELAXED_LIMIT }
