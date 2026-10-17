const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const configPath = path.resolve(__dirname, '../../client/vercel.json')
const vercelConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'))

test('Vercel proxies API requests before the SPA fallback', () => {
  const [apiRewrite, spaRewrite] = vercelConfig.rewrites
  const sourcePattern = new RegExp(`^${spaRewrite.source}$`)

  assert.equal(apiRewrite.source, '/api/:path*')
  assert.match(apiRewrite.destination, /^https:\/\/encore-api-7xew\.onrender\.com\/api\/:path\*$/)
  assert.equal(spaRewrite.source, '/((?!api/|api$).*)')
  assert.equal(spaRewrite.destination, '/index.html')
  assert.equal(sourcePattern.test('/events/a1000000-0000-4000-8000-000000000001'), true)
  assert.equal(sourcePattern.test('/account/bookings'), true)
  assert.equal(sourcePattern.test('/api'), false)
  assert.equal(sourcePattern.test('/api/unknown'), false)
})
