import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readLocalInventree } from '../src/dev/local-inventree.ts'
import { readDevState } from '../src/dev/state.ts'

const token = (letter: string) => `inv-${letter.repeat(40)}-20261106`
const local = {
  version: 1,
  instance_id: '1'.repeat(32),
  image:
    'inventree/inventree@sha256:36027b18ac12e428d0adeda1428325a79c915d571f9c22e2efa0d736f68a3d53',
  db_password: '1'.repeat(48),
  secret_key: '2'.repeat(64),
  admin_password: '3'.repeat(24),
  initialized: true,
  tokens: { reader: token('r'), writer: token('w') },
}

function directory() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'local-inventree-')))
  const state = join(root, 'state')
  mkdirSync(state, { mode: 0o700 })
  return { root, state }
}

test('the local instance and its read token come from private state only', async () => {
  const { root, state } = directory()
  try {
    await assert.rejects(
      readLocalInventree({ INTAKE_DEV_STATE: state }),
      /local_inventree_not_ready_run_up/,
    )
    writeFileSync(join(state, 'inventree-dev.json'), JSON.stringify({ ...local, tokens: null }), {
      mode: 0o600,
    })
    await assert.rejects(
      readLocalInventree({ INTAKE_DEV_STATE: state }),
      /local_inventree_not_ready_run_up/,
    )
    rmSync(join(state, 'inventree-dev.json'))
    writeFileSync(join(state, 'inventree-dev.json'), JSON.stringify(local), { mode: 0o644 })
    await assert.rejects(
      readLocalInventree({ INTAKE_DEV_STATE: state }),
      /private_owned_state_required/,
    )
    rmSync(join(state, 'inventree-dev.json'))
    writeFileSync(join(state, 'inventree-dev.json'), JSON.stringify(local), { mode: 0o600 })
    assert.deepEqual(await readLocalInventree({ INTAKE_DEV_STATE: state }), {
      instanceId: local.instance_id,
      readToken: local.tokens.reader,
    })
  } finally {
    rmSync(root, { recursive: true })
  }
})

test('version 3 app state binds the fixed local target and its instance', async () => {
  const { root } = directory()
  try {
    const app = join(root, 'app')
    mkdirSync(app, { mode: 0o700 })
    const url = (user: string) =>
      `postgresql://${user}:x@127.0.0.1:55433/intake_dev_${'a'.repeat(32)}`
    const state = {
      version: 3,
      serverId: 'd'.repeat(32),
      instanceId: '1'.repeat(32),
      databaseName: `intake_dev_${'a'.repeat(32)}`,
      identity: {
        actor: '00000000-0000-4000-8000-000000000001',
        target: '00000000-0000-4000-8000-000000000002',
        context: '00000000-0000-4000-8000-000000000003',
      },
      target: {
        kind: 'local-inventree',
        origin: 'http://127.0.0.1:4320',
        credentialRef: 'local_inventree_dev',
      },
      apiUrl: url('intake_api'),
      processingUrl: url('intake_processing'),
      mediaUrl: url('intake_media'),
      schedulerUrl: url('intake_scheduler'),
      blobRoot: join(app, 'retained/blobs'),
      channelSecret: 'f'.repeat(64),
    }
    writeFileSync(join(app, 'app.json'), JSON.stringify(state), { mode: 0o600 })
    const loaded = await readDevState(app)
    assert.equal(loaded.version, 3)
    for (const broken of [
      { ...state, target: { ...state.target, origin: 'https://inventory.example.invalid' } },
      { ...state, instanceId: 'short' },
    ]) {
      rmSync(join(app, 'app.json'))
      writeFileSync(join(app, 'app.json'), JSON.stringify(broken), { mode: 0o600 })
      await assert.rejects(readDevState(app), /invalid_readonly_dev_target|invalid_dev_state/)
    }
  } finally {
    rmSync(root, { recursive: true })
  }
})
