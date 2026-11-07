import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentChild } from '../src/agents/child.ts'
import { admitClaudeSession } from '../src/agents/claude-session-admission.ts'

// web-fetch-agent is the built-in set a 2.1.319 subscription CLI reports; extra-agent is a user agent.
for (const mode of ['normal', 'web-fetch-agent', 'skills-enabled', 'extra-tool', 'extra-agent']) {
  test(`Claude pre-input admission: ${mode}`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'claude-admission-'))
    const path = join(root, 'provider.cjs')
    const log = join(root, 'events')
    const tools = [
      'status',
      'ask',
      'propose',
      'reply',
      'fetch_evidence',
      'read_inbox',
      'read_batch',
      'record_observation',
      'propose_lot',
      'regroup',
    ]
    await writeFile(path, await readFile(new URL('./fixtures/session-agent.cjs', import.meta.url)))
    await writeFile(join(root, 'fake-session.json'), JSON.stringify({ mode, log, tools }))
    const signal = AbortSignal.timeout(5000)
    const child = new AgentChild(process.execPath, [path], root, {}, signal)
    try {
      if (mode === 'normal' || mode === 'web-fetch-agent') {
        await admitClaudeSession(child, tools, signal)
      } else {
        await assert.rejects(
          admitClaudeSession(child, tools, signal),
          /agent_(policy|tool)_refused/,
        )
      }
      assert.equal(
        await readFile(log, 'utf8').catch(() => ''),
        '',
        'no user message or tool invocation preceded admission',
      )
    } finally {
      child.endInput()
      await child.close()
      await rm(root, { recursive: true })
    }
  })
}
