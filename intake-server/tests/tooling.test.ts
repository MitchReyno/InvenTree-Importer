import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const directoryOfTest = fileURLToPath(new URL('.', import.meta.url))

test('owned service CLI refuses changed allocation and unsafe state before any Docker mutation or SQL', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'intake-tooling-'))
  try {
    const directory = resolve(root, 'private')
    mkdirSync(directory, { mode: 0o700 })
    const stateFile = resolve(directory, 'postgres.json')
    const state = { admin: 'a'.repeat(48), migrator: 'b'.repeat(48), app: 'c'.repeat(48) }
    const fakeDocker = resolve(root, 'docker.ts'), calls = resolve(root, 'calls.jsonl')
    copyFileSync(resolve(directoryOfTest, 'fixtures/docker.ts'), fakeDocker)
    chmodSync(fakeDocker, 0o700)
    writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 })
    const invoke = () => spawnSync(process.execPath, [resolve(directoryOfTest, '../scripts/dev-services.cjs'), 'start'], {
      encoding: 'utf8', env: { PATH: process.env.PATH, DOCKER_BIN: fakeDocker, INTAKE_DEV_STATE: directory, INTAKE_FIXTURE_CALLS: calls }, timeout: 10000,
    })
    const allocation = invoke()
    assert.equal(allocation.status, 1)
    assert.match(allocation.stderr, /owned_service_allocation_changed_request_coordinator/)
    assert(readFileSync(calls, 'utf8').trim().split('\n').every(line => ['ps', 'compose', 'inspect'].includes(JSON.parse(line)[0])), 'refusal must issue only read-only Docker operations')
    writeFileSync(calls, '')
    chmodSync(stateFile, 0o644)
    const unsafeState = invoke()
    assert.equal(unsafeState.status, 1)
    assert.match(unsafeState.stderr, /invalid_owned_service_state/)
    assert(readFileSync(calls, 'utf8').trim().split('\n').every(line => ['ps', 'compose', 'inspect'].includes(JSON.parse(line)[0])), 'unsafe state must not authorize a Docker mutation')
    assert.equal(readFileSync(stateFile, 'utf8'), JSON.stringify(state), 'unsafe state must never be regenerated')
    for (const result of [allocation, unsafeState]) for (const password of Object.values(state)) assert(!(result.stdout + result.stderr).includes(password))
  } finally { rmSync(root, { recursive: true }) }
})
