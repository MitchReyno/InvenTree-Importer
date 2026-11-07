import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readdir, chmod, writeFile, unlink, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  requireCodexSessionVersion,
  requireClaudeSessionConfig,
  requireCodexSessionConfig,
  rememberAdmission,
  hasAdmission,
} from '../src/agents/session-admission.ts'

test('unknown or malformed native versions are refused', () => {
  requireCodexSessionVersion('bench_intake/0.166.0 (test)')
  for (const version of [
    undefined,
    '',
    'bench_intake/0.166.1',
    'bench_intake/0.166.0-dev',
    'other/0.166.0',
  ]) {
    assert.throws(() => requireCodexSessionVersion(version), /agent_version_unqualified/)
  }
})

test('configuration admission rejects absent, ignored and widened settings', () => {
  const config = {
    approval_policy: 'never',
    sandbox_mode: 'read-only',
    web_search: 'disabled',
    features: {
      code_mode: { enabled: false },
      goals: false,
      shell_tool: false,
      view_image: false,
      apps: false,
      plugins: false,
      remote_plugin: false,
      memories: false,
      multi_agent: false,
      request_permissions_tool: false,
    },
    skills: { bundled: { enabled: false }, include_instructions: false },
  }
  requireCodexSessionConfig(config)
  for (const change of [
    { ...config, features: {} },
    { ...config, features: { ...config.features, code_mode: { enabled: true } } },
    { ...config, skills: { ...config.skills, include_instructions: true } },
    { ...config, approval_policy: 'on-request' },
  ])
    assert.throws(() => requireCodexSessionConfig(change), /agent_policy_refused/)
})

test('conversation admission is bound to conversation, provider and authentication', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-admission-'))
  const selection = { provider: 'codex', authentication: 'api_key', model: 'test' } as const
  try {
    assert.equal(await hasAdmission(root, selection, 'legacy'), false)
    await rememberAdmission(root, selection, 'new')
    assert.equal(await hasAdmission(root, selection, 'new'), true)
    assert.equal(await hasAdmission(root, selection, 'legacy'), false)
    assert.equal(
      await hasAdmission(root, { ...selection, authentication: 'subscription' }, 'new'),
      false,
    )
    assert.equal(await hasAdmission(root, { ...selection, provider: 'claude' }, 'new'), false)
  } finally {
    await rm(root, { recursive: true })
  }
})

test('invalid or redirected provenance is never accepted', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-admission-'))
  const selection = { provider: 'codex', authentication: 'api_key', model: 'test' } as const
  try {
    await rememberAdmission(root, selection, 'new')
    const file = join(root, (await readdir(root))[0])
    await chmod(file, 0o644)
    assert.equal(await hasAdmission(root, selection, 'new'), false)
    await chmod(file, 0o600)
    await writeFile(file, 'corrupt')
    assert.equal(await hasAdmission(root, selection, 'new'), false)
    await unlink(file)
    await writeFile(join(root, 'untrusted'), 'not a provenance marker')
    await symlink(join(root, 'untrusted'), file)
    await assert.rejects(hasAdmission(root, selection, 'new'), /agent_admission_unavailable/)
  } finally {
    await rm(root, { recursive: true })
  }
})

test('Claude admission checks effective startup customizations and version', () => {
  const config = {
    claude_code_version: '2.1.319',
    permissionMode: 'default',
    output_style: 'default',
    slash_commands: [],
    skills: [],
    additional_directories: [],
    plugins: ['cc-plugin-agents-md', 'cc-plugin-privacy', 'cc-plugin-plugin-authoring'].map(
      (name) => ({ name, path: 'builtin', source: `${name}@builtin` }),
    ),
  }
  requireClaudeSessionConfig(config)
  const telemetry = {
    name: 'cc-plugin-telemetry',
    path: 'builtin',
    source: 'cc-plugin-telemetry@builtin',
  }
  // A subscription session reports the built-in telemetry plugin as well.
  requireClaudeSessionConfig({ ...config, plugins: [...config.plugins, telemetry] })
  for (const change of [
    { ...config, plugins: [...config.plugins, { ...telemetry, path: '/tmp/telemetry' }] },
    {
      ...config,
      plugins: [...config.plugins, { ...telemetry, source: 'cc-plugin-telemetry@market' }],
    },
    { ...config, plugins: [...config.plugins, config.plugins[0]] },
    { ...config, plugins: [...config.plugins, telemetry, { name: 'custom' }] },
    { ...config, skills: ['planted'] },
    { ...config, slash_commands: undefined },
    { ...config, claude_code_version: '2.1.320' },
    { ...config, permissionMode: 'bypassPermissions' },
    { ...config, plugins: [...config.plugins, { name: 'custom' }] },
  ]) {
    assert.throws(() => requireClaudeSessionConfig(change), /agent_policy_refused/)
  }
})
