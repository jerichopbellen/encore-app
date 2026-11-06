// Regression: an unexpected NODE_ENV must not turn IP-based limiting on, even together with a set
// TRUST_PROXY_HOPS. "Production" (capital P) is the realistic typo: it looks like production but is not
// the exact string, and on Render it would otherwise key every visitor to one shared bucket.
// NODE_ENV and TRUST_PROXY_HOPS must be set before the shared scenario loads the app.
process.env.NODE_ENV = 'Production'
process.env.TRUST_PROXY_HOPS = '2'

require('../helpers/ipLimitingDisabledScenario.cjs').defineIpLimitingDisabledTests('NODE_ENV=Production (typo), TRUST_PROXY_HOPS=2')
