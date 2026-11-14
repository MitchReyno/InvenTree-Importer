const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, writeFile, symlink } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { execFileSync } = require('node:child_process')
const { join, resolve } = require('node:path')
const { developmentEnvironment, apiEnvironment } = require('../dev/environment.cjs')

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

test('the switches load from the file, and retired names still load so the launcher can refuse them', async () => {
  const root = await directory()
  const switches = {
    INTAKE_USE_MOCK_INVENTREE: 'false',
    INTAKE_USE_LOCAL_INVENTREE: 'true',
    INTAKE_INVENTREE_URL: 'http://127.0.0.1:12345',
    INTAKE_INVENTREE_TOKEN: 'synthetic-token',
    INTAKE_INVENTREE_READ_ONLY: 'true',
    INTAKE_USE_MOCK_AI_AGENTS: 'false',
    INTAKE_USE_AGENT_SESSIONS: 'true',
    INTAKE_RUN_AGENTS_IN_VM: 'false',
    INTAKE_VM_AGENT_TOOLS: 'true',
    INTAKE_VM_NAME: 'bench-agent-test',
    INTAKE_VM_GUEST_DIR: '/var/tmp/bench-paired',
    INTAKE_VM_RUNNER_IMAGE: 'bench-intake-runner:personal-test',
    INTAKE_VM_KEEP_RUNNING: 'false',
    INTAKE_TARGET_PROFILE: 'local-inventree',
    INTAKE_PROCESSING_PROFILE: 'native-agent/2',
    INTAKE_PERSONAL_MANAGEMENT: '1',
  }
  await writeFile(
    join(root, '.env'),
    Object.entries(switches)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n'),
  )
  assert.deepEqual(await developmentEnvironment(root, {}), switches)
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

test('standalone API child receives runtime settings but no setup/provider or unrelated shell secrets', () => {
  const inherited = {
    PATH: '/controlled/bin',
    INTAKE_ORIGIN: 'http://127.0.0.1:12345',
    INTAKE_DEV_API_KEY: 'synthetic-inventory-runtime',
    INTAKE_DATABASE_URL: 'postgresql://intake_fixture:synthetic@127.0.0.1/owned',
    INTAKE_DEV_ADMIN_URL: 'synthetic-admin-never-runtime',
    OPENAI_API_KEY: 'synthetic-provider-never-runtime',
    ANTHROPIC_API_KEY: 'synthetic-second-provider-never-runtime',
    INTAKE_CODEX_EXECUTABLE: 'never-spawn',
    NODE_OPTIONS: '--require=never-load',
    VITE_PRIVATE_TOKEN: 'never-browser',
    ARBITRARY_SECRET: 'never-child',
  }
  const env = apiEnvironment(inherited)
  const child = JSON.parse(
    execFileSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.env))'], {
      env,
      encoding: 'utf8',
    }),
  )
  assert.equal(child.INTAKE_ORIGIN, 'http://127.0.0.1:12345')
  assert.equal(child.INTAKE_DEV_API_KEY, 'synthetic-inventory-runtime')
  assert.equal(child.INTAKE_DATABASE_URL, inherited.INTAKE_DATABASE_URL)
  for (const key of [
    'INTAKE_DEV_ADMIN_URL',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'INTAKE_CODEX_EXECUTABLE',
    'NODE_OPTIONS',
    'VITE_PRIVATE_TOKEN',
    'ARBITRARY_SECRET',
  ]) {
    assert.equal(child[key], undefined, key)
  }
  assert.equal(inherited.OPENAI_API_KEY, 'synthetic-provider-never-runtime')
})
