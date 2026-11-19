const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, rm, writeFile } = require('node:fs/promises')
const { createRequire } = require('node:module')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')

const repository = resolve(__dirname, '../..')
const frontend = join(repository, 'frontend')
const PLANTED = 'planted-replacement-0123456789abcdef'

test('the frontend dev server never serves a saved read token from inside the workspace', async (t) => {
  const directory = await mkdtemp(join(frontend, '.secrets-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(join(directory, 'inventory-read-token'), PLANTED, { mode: 0o600 })
  await writeFile(join(directory, '.inventory-read-token.1234.tmp'), PLANTED, { mode: 0o600 })
  await writeFile(join(directory, 'control.txt'), 'served')
  const vitePath = createRequire(join(frontend, 'package.json')).resolve('vite')
  const { createServer } = await import(pathToFileURL(vitePath).href)
  const vite = await createServer({
    root: frontend,
    configFile: join(frontend, 'vite.config.ts'),
    server: { port: 0, strictPort: false },
    logLevel: 'silent',
  })
  await vite.listen()
  t.after(() => vite.close())
  const base = vite.resolvedUrls.local[0]
  const served = (name) => fetch(new URL(`/@fs${join(directory, name)}`, base))

  const control = await served('control.txt')
  const token = await served('inventory-read-token')
  const temporary = await served('.inventory-read-token.1234.tmp')

  // The control file proves /@fs reaches this directory at all.
  assert.equal(control.status, 200)
  for (const response of [token, temporary]) {
    assert.equal(response.status, 403)
    assert.ok(!(await response.text()).includes(PLANTED))
  }
})
