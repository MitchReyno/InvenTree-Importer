import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { processingFixture } from '../support/processing.ts'
import { lotSession } from '../support/sessions.ts'
import { guestTurn } from '../support/guest-turn.ts'
import { startSessionToolServer } from '#/agents/tools/server.ts'
import { runSessionTurn } from '#/agents/session/session-runner.ts'

const RESEARCH = 'Open the manufacturer’s own datasheet before any distributor page.'

type Opening = Record<string, unknown> & { instructions: string }

/** One host session turn of the fake CLI, whose input seals `stageInstructions`; its opening. */
async function hostOpening(
  t: TestContext,
  provider: 'claude' | 'codex',
  stageInstructions?: string,
) {
  const fixture = await processingFixture()
  t.after(() => fixture.dispose())
  const server = await startSessionToolServer({
    pool: fixture.runner.pool,
    config: fixture.config,
    statusIntervalMs: 0,
  })
  t.after(() => server.close())
  const root = await mkdtemp(join(tmpdir(), 'step-instructions-process-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const executable = join(root, 'provider.cjs')
  const source = await readFile(new URL('../fixtures/session-agent.cjs', import.meta.url), 'utf8')
  await writeFile(executable, `#!/usr/bin/env node\n${source}`, { mode: 0o700 })
  const capture = await fixture.seedCapture()
  const session = await lotSession(fixture, capture, capture.packetA, {
    state: 'queued',
    profile: {
      id: 'native-agent/2',
      agent: { provider, authentication: 'api_key', model: `fake-${provider}-model` },
      settingsRevision: '1',
      stageInstructions,
    },
  })
  const stateRoot = join(root, 'state')
  const log = join(root, 'session.log')
  // The fake reads its mode from the private session directory it runs in.
  await mkdir(join(stateRoot, 'sessions', session.job), { recursive: true, mode: 0o700 })
  await writeFile(
    join(stateRoot, 'sessions', session.job, 'fake-session.json'),
    JSON.stringify({ mode: 'normal', log }),
  )
  const outcome = await runSessionTurn(
    {
      pool: fixture.runner.pool,
      config: fixture.config,
      host: {
        codexExecutable: executable,
        claudeExecutable: executable,
        stateRoot,
        env: {
          PATH: process.env.PATH,
          HOME: root,
          OPENAI_API_KEY: 'synthetic-only',
          ANTHROPIC_API_KEY: 'synthetic-only',
        },
      },
      toolUrl: server.url,
    },
    session.attempt,
    AbortSignal.timeout(30_000),
  )
  const events = (await readFile(log, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { event: string; text?: string })
  assert.equal(outcome, 'finished', JSON.stringify(events))
  const opening = events.find((event) => event.event === 'opening')
  assert.ok(opening?.text, JSON.stringify(events))
  return JSON.parse(opening.text) as Opening
}

for (const provider of ['claude', 'codex'] as const) {
  test(
    `${provider}: a session's opening holds its step instructions after the app's rules`,
    { timeout: 60_000 },
    async (t) => {
      const opening = await hostOpening(t, provider, RESEARCH)
      assert.equal(opening.stage_instructions, RESEARCH)
      assert.equal(Object.keys(opening).at(-1), 'stage_instructions')
      assert.match(
        opening.instructions,
        /Operator guidance for this step: [^]*the rules above win\.$/,
      )
      const plain = await hostOpening(t, provider)
      assert.equal('stage_instructions' in plain, false)
      assert.equal(plain.instructions.includes('Operator guidance for this step'), false)
    },
  )
}

test(
  'a guest validates an input sealing step instructions and its CLI opens with them',
  { timeout: 60_000 },
  async (t) => {
    const run = await guestTurn(t, { stageInstructions: RESEARCH })
    assert.equal(run.served.status, 'fulfilled')
    assert.deepEqual(
      run.outcome,
      { status: 'fulfilled', value: 'finished' },
      JSON.stringify(run.events),
    )
    const opening = run.events.find((event) => event.event === 'opening') as
      { text: string } | undefined
    assert.ok(opening, JSON.stringify(run.events))
    assert.equal((JSON.parse(opening.text) as Opening).stage_instructions, RESEARCH)
  },
)
