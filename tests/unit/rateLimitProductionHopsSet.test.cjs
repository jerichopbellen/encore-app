// Regression: even with TRUST_PROXY_HOPS set in production, IP-based limiting stays OFF, Express is
// not told to trust a proxy, and account-keyed limiting stays ON. The value 3 is a test value only.
// NODE_ENV and TRUST_PROXY_HOPS must be set before the shared scenario loads the app.
process.env.NODE_ENV = 'production'
process.env.TRUST_PROXY_HOPS = '3'

require('../helpers/ipLimitingDisabledScenario.cjs').defineIpLimitingDisabledTests('production, TRUST_PROXY_HOPS=3')
