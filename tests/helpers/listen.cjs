// Starts an Express app on an ephemeral loopback port for one test and always closes it.
async function withServer(app, run) {
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  try {
    return await run(`http://127.0.0.1:${server.address().port}`)
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
}

// Sends a JSON request and returns { status, body, headers }.
async function send(baseUrl, method, path, { headers = {}, json } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : undefined,
  })
  const text = await response.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  return { status: response.status, body, headers: response.headers }
}

module.exports = { withServer, send }

// Tests live outside server/, so server dependencies are resolved from the server folder.
const { createRequire } = require('node:module')
const path = require('node:path')
const serverRequire = createRequire(path.join(__dirname, '../../server/package.json'))

module.exports.serverRequire = serverRequire
