const { readdirSync } = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const suiteName = process.argv[2]
if (!['unit', 'integration'].includes(suiteName)) {
  console.error('Choose a test suite: unit or integration.')
  process.exit(2)
}

const suiteDirectory = path.join(__dirname, suiteName)
function findTestFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return findTestFiles(entryPath)
    return entry.isFile() && entry.name.endsWith('.test.cjs') ? [entryPath] : []
  })
}

const files = findTestFiles(suiteDirectory).sort()
if (files.length === 0) {
  console.error(`No .test.cjs files found in the ${suiteName} suite.`)
  process.exit(1)
}

const runnerArgs = ['--test']
if (suiteName === 'integration') runnerArgs.push('--test-concurrency=1')
runnerArgs.push(...files)

const result = spawnSync(process.execPath, runnerArgs, { stdio: 'inherit' })
if (result.error) {
  console.error('Could not start the Node.js test runner.')
  process.exit(1)
}
process.exit(result.status ?? 1)
