import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { once } from 'node:events'
import { randomBytes } from 'node:crypto'
import { managementServer, credentialPath } from '#/agents/shared-vm/credential-http.ts'
import { readClaudeToken } from '#/agents/shared-vm/claude-credential.ts'
import { nativeAgentHost, agentEnvironment } from '#/agents/environment.ts'

test('operator credential changes require the trusted origin, key and current revision', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'personal-credential-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const key = randomBytes(32).toString('hex')
  const origin = 'https://personal.example'
  assert.throws(() => managementServer(directory, 'http://lan.example', key))
  const server = managementServer(directory, origin, key)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const url = 'http://127.0.0.1:' + address.port + credentialPath
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const call = (body: object, caller = origin, authority = key) =>
    fetch(url, {
      method: 'POST',
      headers: {
        origin: caller,
        authorization: 'Bearer ' + authority,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  const token = 'sk-ant-oat01-test-sentinel-token'
  const newToken = token + '-new'
  const initial = await (await call({ action: 'status' })).json()
  const save = { action: 'save', token, revision: initial.revision }
  assert.equal((await call(save, 'https://other.example')).status, 403)
  assert.equal((await call(save, origin, 'dev-actor')).status, 403)
  const saved = await (await call(save)).json()
  assert.deepEqual(Object.keys(saved).sort(), ['configured', 'revision'])
  assert.equal(saved.configured, true)
  assert.equal(readClaudeToken(directory), token)
  assert.equal((await call(save)).status, 409)
  const replaced = await (await call({ ...save, token: newToken, revision: saved.revision })).json()
  assert.equal(readClaudeToken(directory), newToken)
  assert.equal((await call({ action: 'remove', revision: saved.revision })).status, 409)
  assert.equal(
    (await (await call({ action: 'remove', revision: replaced.revision })).json()).configured,
    false,
  )
  assert.equal(readClaudeToken(directory), undefined)
})

test('only an explicitly selected guest Claude subscription gets the setup token', () => {
  const host = nativeAgentHost({
    INTAKE_AGENT_STATE_ROOT: '/private-agent',
    CLAUDE_CODE_OAUTH_TOKEN: 'ambient',
    OPENAI_API_KEY: 'openai',
    ANTHROPIC_API_KEY: 'anthropic',
  })
  const selection = { provider: 'claude', authentication: 'subscription', model: 'haiku' } as const
  assert.equal(agentEnvironment(host, selection, '/tmp').CLAUDE_CODE_OAUTH_TOKEN, undefined)
  host.guestClaudeToken = 'configured'
  const child = agentEnvironment(host, selection, '/tmp')
  assert.equal(child.CLAUDE_CODE_OAUTH_TOKEN, 'configured')
  assert.equal(child.ANTHROPIC_API_KEY, undefined)
  for (const other of [
    { ...selection, authentication: 'api_key' },
    { ...selection, provider: 'codex' },
  ] as const) {
    assert.equal(agentEnvironment(host, other, '/tmp').CLAUDE_CODE_OAUTH_TOKEN, undefined)
  }
})
