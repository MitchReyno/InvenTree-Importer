// The importer reads the local InvenTree's state from Python; these facts must match the Node side.
const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { homedir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { ORIGIN, FILES, TOKEN } = require('../inventree-dev/lib.cjs')

const repository = resolve(__dirname, '../..')
const python = readFileSync(
  join(repository, 'backend/src/invimport/inventree/local_dev.py'),
  'utf8',
)

function pythonConstant(name) {
  const match = python.match(new RegExp(`^${name} = (?:Path\\()?"([^"]+)"\\)?$`, 'm'))
  assert.ok(match, `${name} is defined in local_dev.py`)
  return match[1]
}

test('the importer uses the same local server address and state file name', () => {
  assert.equal(pythonConstant('LOCAL_DEV_ORIGIN'), ORIGIN)
  assert.equal(pythonConstant('STATE_FILE_NAME'), FILES.state)
})

test('the importer accepts the same writer token form', () => {
  const match = python.match(/^_TOKEN = re\.compile\(r"([^"]+)"\)$/m)
  assert.ok(match, '_TOKEN is defined in local_dev.py')
  assert.equal(match[1], TOKEN.source)
})

test('the importer finds the state directory by the same rule', async () => {
  const { stateDirectory } = await import(
    pathToFileURL(join(repository, 'intake-server/src/dev/pg-identity.ts')).href
  )
  const defaultDirectory = pythonConstant('DEFAULT_STATE_DIRECTORY')
  assert.equal(stateDirectory({}), join(homedir(), defaultDirectory))
  assert.equal(stateDirectory({ INTAKE_DEV_STATE: '/tmp/x/../state' }), '/tmp/state')
  assert.match(python, /environ\.get\("INTAKE_DEV_STATE"\)/)
})
