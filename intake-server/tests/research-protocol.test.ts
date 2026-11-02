import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { PassThrough } from 'node:stream'
import type { ProcessingEnvelopeDto, ProcessingProposalV3Dto } from '@invimport/contracts'
import { researchTrustedInstructions } from '../src/processing/policy.ts'
import { researchInputManifest, sealed } from '../src/processing/model.ts'
import type { ResearchInput } from '../src/processing/runner.ts'
import { restrictedResearchRunner } from '../src/research/adapter.ts'
import type { ResearchProtocolSession } from '../src/research/protocol.ts'
import { ResearchReapPendingError } from '../src/research/errors.ts'
import { emptyProcessingMedia, manualInputFixture } from './support/processing-input.ts'

function inputFixture(): ResearchInput {
  const capture = manualInputFixture()
  const media = emptyProcessingMedia(capture, capture.lots[0].id)
  const manifest = researchInputManifest(
    capture,
    capture.lots[0].id,
    'research',
    [],
    null,
    { manifest: media.bytes.toString(), sha256: media.digest.toString('hex') },
    [],
  )
  return {
    manifest,
    instructions: researchTrustedInstructions,
    payload: {
      schema_version: 'bench-intake-processing-command/3',
      profile_id: 'restricted-research-stub/1',
      handler_version: 'processing/3',
      job_id: randomUUID(),
      attempt_id: randomUUID(),
      input_id: randomUUID(),
      command_id: randomUUID(),
      input_sha256: sealed(manifest).digest.toString('hex'),
    },
  }
}

function proposal(input: ResearchInput): ProcessingProposalV3Dto {
  return {
    schema_version: 'bench-intake-proposal/3',
    subject_id: input.manifest.subject_id,
    summary: 'Synthetic protocol result.',
    sources: [{ kind: 'research_receipt', receipt_id: randomUUID(), sha256: 'a'.repeat(64) }],
  }
}

interface ScriptOptions {
  ready: (push: (frame: unknown) => void) => void
  close?: () => Promise<void>
}

function scriptedSession(options: ScriptOptions) {
  const messages = new PassThrough({ objectMode: true })
  const sent: Record<string, unknown>[] = []
  let closed = false
  const session: ResearchProtocolSession = {
    messages,
    async send(value) {
      const frame = value as Record<string, unknown>
      sent.push(frame)
      if (frame.method === 'initialize') {
        messages.write({ id: frame.id, result: { userAgent: 'synthetic' } })
      } else if (frame.method === 'thread/start') {
        messages.write({ id: frame.id, result: { thread: { id: 'opaque-thread' } } })
      } else if (frame.method === 'turn/start') {
        messages.write({ id: frame.id, result: { turn: { id: 'opaque-turn' } } })
        options.ready((reply) => messages.write(reply))
      }
    },
    async close() {
      await options.close?.()
      closed = true
      messages.end()
    },
  }
  return { session, sent, isClosed: () => closed }
}

function call(id: string | number, callId: string, tool: string, args: unknown) {
  return {
    id,
    method: 'item/tool/call',
    params: {
      threadId: 'opaque-thread',
      turnId: 'opaque-turn',
      callId,
      namespace: 'bench_intake',
      tool,
      arguments: args,
    },
  }
}

function completed() {
  return {
    method: 'turn/completed',
    params: { threadId: 'opaque-thread', turn: { id: 'opaque-turn', status: 'completed' } },
  }
}

test('exact opaque calls reuse one broker UUID and host constructs source-bound sequenced envelopes', async () => {
  const input = inputFixture()
  const candidate = proposal(input)
  const fake = scriptedSession({
    ready(push) {
      push(call(7, 'opaque-call/part', 'lookup_inventory', { model: 'part', pk: '93' }))
      push(call(8, 'opaque-call/part', 'lookup_inventory', { model: 'part', pk: '93' }))
      push(call('proposal:1', 'opaque-proposal', 'submit_proposal', candidate))
      push(call('proposal:2', 'opaque-proposal', 'submit_proposal', candidate))
      push(completed())
    },
  })
  const brokerCalls: { requestId: string; tool: string }[] = []
  const messages: ProcessingEnvelopeDto[] = []
  let brokerClosed = false
  const runner = restrictedResearchRunner({
    createSession: async () => fake.session,
    createBroker: async () => ({
      async call(tool, _args, requestId) {
        brokerCalls.push({ tool, requestId })
        return {
          receipt: {
            id: randomUUID(),
            kind: 'inventory',
            sha256: 'b'.repeat(64),
            byte_size: '7',
            media_type: 'application/json',
          },
          observation: { model: 'part', pk: '93', label: 'Synthetic Part' },
        }
      },
      close() {
        brokerClosed = true
      },
    }),
  })
  await runner.run(input, async (message) => {
    if (message.kind === 'terminal') {
      assert.equal(fake.isClosed(), true)
      assert.equal(brokerClosed, true)
    }
    messages.push(message)
  })
  assert.equal(brokerCalls.length, 1)
  assert.match(brokerCalls[0].requestId, /^[a-f0-9-]{36}$/)
  assert.notEqual(brokerCalls[0].requestId, 'opaque-call/part')
  assert.deepEqual(
    messages.map((message) => [message.kind, message.sequence]),
    [
      ['proposal', '1'],
      ['terminal', '2'],
    ],
  )
  assert.ok(
    messages.every(
      (message) =>
        message.attempt_id === input.payload.attempt_id &&
        message.command_id === input.payload.command_id &&
        message.handler_version === 'processing/3',
    ),
  )
  assert.equal(fake.sent.filter((frame) => frame.id === 7 || frame.id === 8).length, 2)
  assert.equal(
    fake.sent.some((frame) => frame.method === 'thread/resume'),
    false,
  )
})

test('question closes the exact session before application publication and never resumes it', async () => {
  const input = inputFixture()
  const question = {
    kind: 'quantity',
    subject_id: input.manifest.subject_id,
    prompt: 'Count this sample.',
    reason: 'Synthetic confirmation.',
  }
  const fake = scriptedSession({
    ready(push) {
      push(call('native-request', 'native-call', 'ask_question', question))
    },
  })
  const messages: ProcessingEnvelopeDto[] = []
  const runner = restrictedResearchRunner({
    createSession: async () => fake.session,
    createBroker: async () => ({
      call: async () => assert.fail('question is not a broker tool'),
      close() {},
    }),
  })
  await runner.run(input, async (message) => {
    assert.equal(fake.isClosed(), true)
    messages.push(message)
  })
  assert.deepEqual(
    messages.map((message) => [message.kind, message.sequence]),
    [['question', '1']],
  )
})

test('changed duplicate call refuses without a second broker effect or terminal publication', async () => {
  const input = inputFixture()
  const fake = scriptedSession({
    ready(push) {
      push(call('request-a', 'same-call', 'lookup_inventory', { model: 'part', pk: '93' }))
      push(call('request-b', 'same-call', 'lookup_inventory', { model: 'part', pk: '94' }))
    },
  })
  let calls = 0
  const runner = restrictedResearchRunner({
    createSession: async () => fake.session,
    createBroker: async () => ({
      async call() {
        calls += 1
        return {
          receipt: {
            id: randomUUID(),
            kind: 'inventory',
            sha256: 'a'.repeat(64),
            byte_size: '1',
            media_type: 'application/json',
          },
          observation: { model: 'part', pk: '93', label: 'fixture' },
        }
      },
      close() {},
    }),
  })
  await assert.rejects(
    () => runner.run(input, async () => assert.fail('no application result')),
    /research_protocol_invalid/,
  )
  assert.equal(calls, 1)
  assert.equal(fake.isClosed(), true)
})

test('foreign identities, unknown tools and native permission requests fail closed without app questions', async () => {
  const input = inputFixture()
  const base = call('request', 'call', 'lookup_inventory', { model: 'part', pk: '93' })
  const refused = [
    { ...base, params: { ...base.params, threadId: 'old-thread' } },
    { ...base, params: { ...base.params, turnId: 'old-turn' } },
    { ...base, params: { ...base.params, namespace: null } },
    { ...base, params: { ...base.params, tool: 'shell' } },
    { ...base, method: 'item/permissions/requestApproval' },
    {
      method: 'item/started',
      params: {
        threadId: 'opaque-thread',
        turnId: 'opaque-turn',
        item: { type: 'commandExecution' },
      },
    },
  ]
  for (const frame of refused) {
    const fake = scriptedSession({
      ready(push) {
        push(frame)
      },
    })
    const runner = restrictedResearchRunner({
      createSession: async () => fake.session,
      createBroker: async () => ({ call: async () => assert.fail('no broker effect'), close() {} }),
    })
    await assert.rejects(
      () => runner.run(input, async () => assert.fail('no application question')),
      /research_(protocol_invalid|tool_refused)/,
    )
    assert.equal(fake.isClosed(), true)
  }
})

test('unconfirmed reap cannot emit a question or a terminal', async () => {
  const input = inputFixture()
  const fake = scriptedSession({
    ready(push) {
      push(
        call('request', 'call', 'ask_question', {
          kind: 'clarification',
          subject_id: input.manifest.subject_id,
          prompt: 'Fixture question',
          reason: 'Fixture reason',
        }),
      )
    },
    close: async () => {
      throw new ResearchReapPendingError()
    },
  })
  const runner = restrictedResearchRunner({
    createSession: async () => fake.session,
    createBroker: async () => ({ call: async () => assert.fail(), close() {} }),
  })
  await assert.rejects(
    () => runner.run(input, async () => assert.fail('no command-ending output')),
    ResearchReapPendingError,
  )
})

test('cancellation and stalled sends remain bounded and confirm cleanup before returning', async () => {
  for (const stalledSend of [false, true]) {
    const input = inputFixture()
    const fake = scriptedSession({ ready() {} })
    if (stalledSend) {
      fake.session.send = async () => new Promise<void>(() => {})
    }
    const runner = restrictedResearchRunner({
      sessionTimeoutMs: 30,
      createSession: async () => fake.session,
      createBroker: async () => ({ call: async () => assert.fail(), close() {} }),
    })
    await assert.rejects(() => runner.run(input, async () => assert.fail()), /research_cancelled/)
    assert.equal(fake.isClosed(), true)
  }
})

test('late session creation remains reap-pending and is closed when it eventually resolves', async () => {
  const input = inputFixture()
  const fake = scriptedSession({ ready() {} })
  const runner = restrictedResearchRunner({
    sessionTimeoutMs: 10,
    createBroker: async () => ({ call: async () => assert.fail(), close() {} }),
    createSession: async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
      return fake.session
    },
  })
  await assert.rejects(() => runner.run(input, async () => assert.fail()), ResearchReapPendingError)
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.equal(fake.isClosed(), true)
})

test('cancellation during confirmed close suppresses a late application question', async () => {
  const input = inputFixture()
  const controller = new AbortController()
  const fake = scriptedSession({
    ready(push) {
      push(
        call('request', 'call', 'ask_question', {
          kind: 'clarification',
          subject_id: input.manifest.subject_id,
          prompt: 'Fixture',
          reason: 'Fixture',
        }),
      )
    },
    async close() {
      controller.abort()
    },
  })
  const runner = restrictedResearchRunner({
    signal: controller.signal,
    createSession: async () => fake.session,
    createBroker: async () => ({ call: async () => assert.fail(), close() {} }),
  })
  await assert.rejects(
    () => runner.run(input, async () => assert.fail('no late question')),
    /research_cancelled/,
  )
  assert.equal(fake.isClosed(), true)
})

test('wire-request reuse and private broker fields cannot cross the protocol boundary', async () => {
  const input = inputFixture()
  for (const privateResult of [false, true]) {
    const fake = scriptedSession({
      ready(push) {
        push(call('same-wire', 'first-call', 'lookup_inventory', { model: 'part', pk: '93' }))
        push(call('same-wire', 'second-call', 'submit_proposal', proposal(input)))
      },
    })
    const runner = restrictedResearchRunner({
      createSession: async () => fake.session,
      createBroker: async () => ({
        async call() {
          const result = {
            receipt: {
              id: randomUUID(),
              kind: 'inventory',
              sha256: 'a'.repeat(64),
              byte_size: '1',
              media_type: 'application/json',
            },
            observation: { model: 'part', pk: '93', label: 'fixture' },
          }
          return privateResult ? { ...result, credential: 'synthetic-private-canary' } : result
        },
        close() {},
      }),
    })
    await assert.rejects(() => runner.run(input, async () => assert.fail('no invalid publication')))
    assert.equal(JSON.stringify(fake.sent).includes('synthetic-private-canary'), false)
    assert.equal(fake.isClosed(), true)
  }
})
