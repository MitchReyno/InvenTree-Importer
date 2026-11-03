const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, writeFile, symlink } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { execFileSync } = require('node:child_process')
const { join, resolve } = require('node:path')
const { developmentEnvironment } = require('../dev/environment.cjs')

async function directory() {
  return mkdtemp(join(tmpdir(), 'intake-env-test-'))
}

test('dotenv grammar supports quotes/comments while shell settings including empty values win', async () => {
  const root = await directory()
  const originalReference = process.env.INTAKE_CREDENTIAL_REF
  await writeFile(
    join(root, '.env'),
    '# Synthetic only\nINTAKE_DEV_PORT=4333\nINTAKE_READ_ORIGIN="http://127.0.0.1:12345" # controlled\nINTAKE_DEV_API_KEY="synthetic#literal"\nINTAKE_CREDENTIAL_REF=fixture\nOPENAI_API_KEY="$(not-a-command)"\n',
    { mode: 0o600 },
  )
  const values = await developmentEnvironment(root, {
    INTAKE_DEV_PORT: '4444',
    INTAKE_DEV_API_KEY: '',
  })
  assert.equal(values.INTAKE_DEV_PORT, '4444')
  assert.equal(values.INTAKE_DEV_API_KEY, '')
  assert.equal(values.INTAKE_READ_ORIGIN, 'http://127.0.0.1:12345')
  assert.equal(values.INTAKE_CREDENTIAL_REF, 'fixture')
  assert.equal(values.OPENAI_API_KEY, '$(not-a-command)')
  assert.equal(process.env.INTAKE_CREDENTIAL_REF, originalReference)
})

test('only documented server settings are accepted from files; process flags and Vite secrets are excluded', async () => {
  const root = await directory()
  await writeFile(
    join(root, '.env'),
    'PATH=poison\nHOME=poison\nNODE_OPTIONS=--require=poison\nVITE_INVENTORY_TOKEN=never-client\nARBITRARY_SECRET=never-child\nINTAKE_DEV_PORT=4333\n',
  )
  const values = await developmentEnvironment(root, { PATH: 'host-path' })
  assert.deepEqual(values, { PATH: 'host-path', INTAKE_DEV_PORT: '4333' })
})

test('default file is optional, explicit missing files fail, and empty selector disables reads', async () => {
  const root = await directory()
  assert.deepEqual(await developmentEnvironment(root, {}), {})
  await assert.rejects(
    developmentEnvironment(root, { INTAKE_ENV_FILE: 'absent' }, root),
    /development_env_file_unreadable/,
  )
  await symlink(join(root, 'absent'), join(root, '.env'))
  assert.deepEqual(await developmentEnvironment(root, { INTAKE_ENV_FILE: '' }), {
    INTAKE_ENV_FILE: '',
  })
})

test('an explicit relative filename is caller-relative and wins over the default file', async () => {
  const root = await directory()
  const other = await directory()
  await writeFile(join(root, '.env'), 'INTAKE_DEV_PORT=4333')
  await writeFile(join(other, 'local.env'), 'INTAKE_DEV_PORT=4444')
  const env = { INTAKE_ENV_FILE: 'local.env', INIT_CWD: other }
  assert.equal((await developmentEnvironment(root, env)).INTAKE_DEV_PORT, '4444')
})

test('unsafe files fail with redacted errors: symlink, excessive bytes and invalid UTF8', async () => {
  const root = await directory()
  const content = join(root, '.env.fixture')
  await writeFile(content, 'INTAKE_DEV_API_KEY=synthetic-never-public')
  await symlink(content, join(root, '.env'))
  await assert.rejects(developmentEnvironment(root, {}), (error) => {
    assert.equal(error.message, 'development_env_file_unreadable')
    assert.equal(String(error).includes('synthetic-never-public'), false)
    return true
  })
  await writeFile(content, Buffer.alloc(65537, 65))
  await assert.rejects(
    developmentEnvironment(root, { INTAKE_ENV_FILE: content }),
    /development_env_file_invalid/,
  )
  await writeFile(content, Buffer.from([0xff, 0xfe, 0xff]))
  await assert.rejects(
    developmentEnvironment(root, { INTAKE_ENV_FILE: content }),
    /development_env_file_invalid/,
  )
})

test('in-checkout env files use root dotenv names denied by Vite; arbitrary source-tree secrets are refused', async () => {
  const root = await directory()
  const file = join(root, 'source-secret.txt')
  await writeFile(file, 'INTAKE_DEV_API_KEY=synthetic-source-secret')
  await assert.rejects(
    developmentEnvironment(root, { INTAKE_ENV_FILE: file }),
    /development_env_file_private_location_required/,
  )
  await writeFile(join(root, '.env.local'), 'INTAKE_DEV_PORT=4444')
  assert.equal(
    (await developmentEnvironment(root, { INTAKE_ENV_FILE: '.env.local', INIT_CWD: root }))
      .INTAKE_DEV_PORT,
    '4444',
  )
})

test(
  'non-regular env files are refused without waiting for pipe contents',
  { skip: process.platform === 'win32' },
  async () => {
    const root = await directory()
    const fifo = join(root, '.env.pipe')
    execFileSync('mkfifo', [fifo])
    await assert.rejects(
      developmentEnvironment(root, { INTAKE_ENV_FILE: fifo }),
      /development_env_file_invalid/,
    )
  },
)

test('checkout dotenv variants are ignored by Git while the documented templates remain stageable', () => {
  const repository = resolve(__dirname, '../..')
  for (const name of ['.env', '.env.local', '.env.development']) {
    execFileSync('git', ['check-ignore', '--no-index', '--quiet', name], { cwd: repository })
  }
  for (const name of ['.env.example', '.env.intake.example']) {
    assert.throws(
      () =>
        execFileSync('git', ['check-ignore', '--no-index', '--quiet', name], { cwd: repository }),
      { status: 1 },
    )
  }
})
