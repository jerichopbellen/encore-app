const cloudinary = require('cloudinary').v2
const { getPosterConfig } = require('../config/posters')

// Every Cloudinary call goes through this module so tests can replace it
// without credentials or network access. Signing happens inside the SDK on the
// server; nothing here is ever sent to the browser or written to logs.
let testGateway

const UPLOAD_TIMEOUT_MS = 60_000
// Deletions run after the database change, while the admin waits for a response;
// a failed one is recorded and retried later, so it does not need a long wait.
const DESTROY_TIMEOUT_MS = 15_000

function configureClient() {
  const { cloudName, apiKey, apiSecret } = getPosterConfig()
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true })
  return cloudinary
}

function uploadImage(buffer, options) {
  if (testGateway) return testGateway.uploadImage(buffer, options)
  const client = configureClient()
  return new Promise((resolve, reject) => {
    const stream = client.uploader.upload_stream(
      { ...options, resource_type: 'image', type: 'upload', timeout: UPLOAD_TIMEOUT_MS },
      (error, result) => (error ? reject(error) : resolve(result)),
    )
    stream.end(buffer)
  })
}

// Resolves to Cloudinary's { result: 'ok' | 'not found' }. Both mean the asset is gone.
function destroyImage(publicId) {
  if (testGateway) return testGateway.destroyImage(publicId)
  return configureClient().uploader.destroy(publicId, {
    resource_type: 'image',
    type: 'upload',
    invalidate: true,
    timeout: DESTROY_TIMEOUT_MS,
  })
}

function setGatewayForTests(gateway) {
  testGateway = gateway
}

module.exports = { uploadImage, destroyImage, setGatewayForTests }
