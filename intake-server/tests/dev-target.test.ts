import assert from 'node:assert/strict'
import { test } from 'node:test'
import { developmentTarget, developmentCredential, developmentStateRoot } from '#/dev/target.ts'

const scope = { serverId: 'd'.repeat(32) }

test('development defaults to fake and external settings select a canonical read-only target', () => {
  assert.deepEqual(developmentTarget({}), { kind: 'fake' })
  const env = {
    INTAKE_READ_ORIGIN: 'https://inventory.example.invalid/',
    INTAKE_CREDENTIAL_REF: 'synthetic',
    INTAKE_DEV_API_KEY: 'synthetic-key',
  }
  const target = developmentTarget(env)
  assert.deepEqual(target, {
    kind: 'read-only',
    origin: 'https://inventory.example.invalid',
    credentialRef: 'synthetic',
  })
  assert.equal(developmentCredential(env, target), 'synthetic-key')
  assert.equal(
    developmentStateRoot(env, target, scope),
    developmentStateRoot(
      { ...env, INTAKE_DEV_API_KEY: 'rotated-synthetic' },
      developmentTarget(env),
      scope,
    ),
  )
  assert.notEqual(
    developmentStateRoot({}, { kind: 'fake' }, scope),
    developmentStateRoot(env, target, scope),
  )
  assert.notEqual(
    developmentStateRoot(env, target, scope),
    developmentStateRoot(env, developmentTarget({ ...env, INTAKE_CREDENTIAL_REF: 'other' }), scope),
  )
})

test('partial/contradictory credentials and non-origin URLs refuse without leaking values', () => {
  assert.throws(
    () =>
      developmentTarget({
        INTAKE_TARGET_PROFILE: 'fake',
        INTAKE_READ_ORIGIN: 'https://example.invalid',
      }),
    /conflicting_development_target_settings/,
  )
  assert.throws(
    () => developmentTarget({ INTAKE_READ_ORIGIN: 'https://example.invalid' }),
    /development_read_target_required/,
  )
  assert.throws(
    () => developmentTarget({ INTAKE_TARGET_PROFILE: 'other' }),
    /unsupported_development_target/,
  )
  const base = { INTAKE_TARGET_PROFILE: 'read-only', INTAKE_CREDENTIAL_REF: 'fixture' }
  for (const origin of [
    'https://user:synthetic-secret@example.invalid',
    'https://example.invalid/path',
    'https://example.invalid/?key=synthetic-secret',
    'file:///private/tmp/fixture',
    'broken',
  ]) {
    assert.throws(
      () => developmentTarget({ ...base, INTAKE_READ_ORIGIN: origin }),
      (error) => {
        assert.equal(String(error).includes('synthetic-secret'), false)
        return true
      },
    )
  }
  const target = developmentTarget({ ...base, INTAKE_READ_ORIGIN: 'https://example.invalid' })
  for (const key of [
    undefined,
    '',
    ' ',
    'synthetic\nkey',
    'synthetic key',
    'synthetic\tkey',
    'synthetic☃',
  ]) {
    assert.throws(
      () => developmentCredential({ INTAKE_DEV_API_KEY: key }, target),
      /development_read_key_required/,
    )
  }
})

test('local-inventree is a fixed loopback target whose key comes from private state', () => {
  const target = developmentTarget({ INTAKE_TARGET_PROFILE: 'local-inventree' })
  assert.deepEqual(target, {
    kind: 'local-inventree',
    origin: 'http://127.0.0.1:4320',
    credentialRef: 'local_inventree_dev',
  })
  assert.equal(developmentCredential({}, target), undefined)
  for (const extra of [
    { INTAKE_READ_ORIGIN: 'https://inventory.example.invalid' },
    { INTAKE_CREDENTIAL_REF: 'synthetic' },
    { INTAKE_DEV_API_KEY: 'synthetic-key' },
    { INTAKE_DEV_ADMIN_URL: 'postgresql://postgres:x@127.0.0.1:6543/postgres' },
  ]) {
    assert.throws(
      () => developmentTarget({ INTAKE_TARGET_PROFILE: 'local-inventree', ...extra }),
      /conflicting_development_target_settings/,
    )
  }
  const one = developmentStateRoot({}, target, {
    serverId: 'd'.repeat(32),
    instanceId: '1'.repeat(32),
  })
  assert.match(one, /\/local-inventree-[a-f0-9]{32}$/)
  assert.notEqual(
    one,
    developmentStateRoot({}, target, { serverId: 'd'.repeat(32), instanceId: '2'.repeat(32) }),
    'a reset instance gets a fresh namespace',
  )
  assert.notEqual(
    one,
    developmentStateRoot({}, target, { serverId: 'e'.repeat(32), instanceId: '1'.repeat(32) }),
  )
  assert.throws(
    () => developmentStateRoot({}, target, { serverId: 'd'.repeat(32) }),
    /local_inventree_instance_required/,
  )
})
