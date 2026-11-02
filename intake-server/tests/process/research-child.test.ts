import { test } from 'node:test'
import assert from 'node:assert/strict'
import { controlledResearchSession } from '../../src/research/child-transport.ts'
import { restrictedResearchRunner } from '../../src/research/adapter.ts'
import type { ProcessingEnvelopeDto } from '@invimport/contracts'
import { researchInputFixture } from '../support/research-input.ts'

const fixtureScript = new URL('../fixtures/research-protocol-child.cjs', import.meta.url)

function child(mode: string, timeoutMs = 2000, artifactIndex = 0) {
  return controlledResearchSession({
    qualification: 'fixture_only',
    script: fixtureScript,
    args: [mode, String(artifactIndex)],
    timeoutMs,
  })
}

test(
  'controlled Node child is reaped before question/terminal and transports exact PNG/PDF bytes',
  { timeout: 10000 },
  async () => {
    for (const selected of [0, 1]) {
      const fixture = researchInputFixture()
      const artifact = fixture.artifacts[selected]
      // Each test input contains both artifacts; the broker proves exact version identity and bytes.
      let reads = 0
      let closed = false
      const messages: ProcessingEnvelopeDto[] = []
      const runner = restrictedResearchRunner({
        createSession: async () => {
          const session = child('evidence-proposal', 2000, selected)
          return {
            send: session.send,
            messages: session.messages,
            async close() {
              await session.close()
              closed = true
            },
          }
        },
        createBroker: async () => ({
          async call(tool, args) {
            assert.equal(tool, 'read_evidence')
            const request = args as {
              version_id: string
              sha256: string
              offset: string
              length: string
            }
            const requested = fixture.artifacts.find(
              (value) => value.versionId === request.version_id,
            )!
            assert.ok(requested)
            assert.equal(request.sha256, requested.digest)
            const offset = Number(request.offset)
            const bytes = requested.bytes.subarray(offset, offset + Number(request.length))
            reads += 1
            return {
              evidence_id: requested.evidenceId,
              version_id: requested.versionId,
              sha256: requested.digest,
              byte_size: String(requested.bytes.length),
              media_type: requested.mediaType,
              offset: request.offset,
              bytes_base64: bytes.toString('base64'),
            }
          },
          close() {},
        }),
      })
      await runner.run(fixture.input, async (message) => {
        if (message.kind === 'terminal') {
          assert.equal(closed, true)
        }
        messages.push(message)
      })
      assert.equal(reads, 1)
      assert.deepEqual(
        messages.map((message) => message.kind),
        ['proposal', 'terminal'],
      )
      const result = messages[0]
      assert.equal(result.kind, 'proposal')
      if (result.kind === 'proposal' && 'sources' in result.payload) {
        assert.deepEqual(result.payload.sources, [
          {
            kind: 'media_version',
            evidence_id: artifact.evidenceId,
            version_id: artifact.versionId,
            sha256: artifact.digest,
          },
        ])
      }
    }
  },
)

test(
  'controlled child question is emitted only after confirmed close',
  { timeout: 5000 },
  async () => {
    const fixture = researchInputFixture()
    let reaped = false
    const runner = restrictedResearchRunner({
      createSession: async () => {
        const session = child('evidence-question')
        return {
          send: session.send,
          messages: session.messages,
          async close() {
            await session.close()
            reaped = true
          },
        }
      },
      createBroker: async () => ({
        async call(_tool, args) {
          const request = args as { version_id: string; offset: string }
          const artifact = fixture.artifacts.find(
            (value) => value.versionId === request.version_id,
          )!
          return {
            evidence_id: artifact.evidenceId,
            version_id: artifact.versionId,
            sha256: artifact.digest,
            byte_size: String(artifact.bytes.length),
            media_type: artifact.mediaType,
            offset: request.offset,
            bytes_base64: artifact.bytes.toString('base64'),
          }
        },
        close() {},
      }),
    })
    const emitted: ProcessingEnvelopeDto[] = []
    await runner.run(fixture.input, async (message) => {
      assert.equal(reaped, true)
      emitted.push(message)
    })
    assert.deepEqual(
      emitted.map((message) => message.kind),
      ['question'],
    )
  },
)

test(
  'controlled child ignores parent synthetic environment and TERM escalation confirms its exact PID gone',
  { timeout: 5000 },
  async () => {
    const previous = process.env.BENCH_RESEARCH_TEST_CANARY
    process.env.BENCH_RESEARCH_TEST_CANARY = 'synthetic-parent-only'
    const environment = child('environment')
    try {
      const result = await environment.messages[Symbol.asyncIterator]().next()
      const observed = result.value as { keys: string[]; canary: string | null }
      assert.equal(observed.canary, null)
      assert.deepEqual(
        observed.keys,
        process.platform === 'darwin' ? ['LANG', '__CF_USER_TEXT_ENCODING'] : ['LANG'],
      )
    } finally {
      await environment.close()
      if (previous === undefined) {
        delete process.env.BENCH_RESEARCH_TEST_CANARY
      } else {
        process.env.BENCH_RESEARCH_TEST_CANARY = previous
      }
    }
    const stubborn = child('ignore-term')
    const ready = await stubborn.messages[Symbol.asyncIterator]().next()
    const pid = (ready.value as { pid: number }).pid
    await stubborn.close()
    assert.throws(
      () => process.kill(pid, 0),
      (error: unknown) => (error as NodeJS.ErrnoException).code === 'ESRCH',
    )
  },
)

test(
  'malformed, partial, oversized and excessive child frames fail boundedly and close',
  { timeout: 10000 },
  async () => {
    for (const mode of [
      'malformed',
      'invalid-utf8',
      'partial',
      'oversized-frame',
      'oversized-stderr',
      'frame-flood',
    ]) {
      const session = child(mode)
      try {
        const iterator = session.messages[Symbol.asyncIterator]()
        await assert.rejects(
          async () => {
            while (!(await iterator.next()).done) {
              /* Drain bounded diagnostic fixtures. */
            }
          },
          /research_(protocol_invalid|capacity)/,
          mode,
        )
      } finally {
        await session.close()
      }
    }
  },
)

test(
  'controlled child lifetime and explicit cancellation terminate only their own process',
  { timeout: 5000 },
  async () => {
    const controller = new AbortController()
    const session = controlledResearchSession({
      qualification: 'fixture_only',
      script: fixtureScript,
      args: ['ignore-term'],
      signal: controller.signal,
      timeoutMs: 2000,
    })
    const iterator = session.messages[Symbol.asyncIterator]()
    const ready = await iterator.next()
    const pid = (ready.value as { pid: number }).pid
    controller.abort()
    await assert.rejects(() => iterator.next(), /research_cancelled/)
    await session.close()
    assert.throws(
      () => process.kill(pid, 0),
      (error: unknown) => (error as NodeJS.ErrnoException).code === 'ESRCH',
    )
    const timed = child('ignore-term', 100)
    try {
      const timedIterator = timed.messages[Symbol.asyncIterator]()
      await assert.rejects(async () => {
        while (!(await timedIterator.next()).done) {
          /* Await the owned deadline. */
        }
      }, /research_protocol_interrupted/)
    } finally {
      await timed.close()
    }
  },
)
