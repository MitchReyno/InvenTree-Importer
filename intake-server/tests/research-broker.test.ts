import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import type { ResearchReceiptDto } from '@invimport/contracts'
import type { ResearchReceiptRepository, ResearchSourceBody } from '#/research/receipts.ts'
import { stagedEvidenceReader } from '#/research/evidence.ts'
import { researchBroker } from '#/research/broker.ts'
import { assertResearchActive, refuseResearch } from '#/research/errors.ts'
import { researchInputFixture } from './support/research-input.ts'

function memoryReceipts() {
  const rows = new Map<string, { receipt: ResearchReceiptDto; bytes: Buffer }>()
  let publications = 0
  const repository: ResearchReceiptRepository = {
    async read(id) {
      const row = rows.get(id)
      assert.ok(row)
      return row
    },
    async publish(_requestId, _request, source: ResearchSourceBody) {
      publications += 1
      const receipt: ResearchReceiptDto = {
        id: randomUUID(),
        kind: source.kind,
        sha256: createHash('sha256').update(source.bytes).digest('hex'),
        byte_size: String(source.bytes.length),
        media_type: source.mediaType,
        ...(source.sourceUrl ? { source_url: source.sourceUrl } : {}),
      }
      rows.set(receipt.id, { receipt, bytes: Buffer.from(source.bytes) })
      return receipt
    },
  }
  return { repository, rows, publications: () => publications }
}

function brokerFixture() {
  const fixture = researchInputFixture()
  const receipts = memoryReceipts()
  let current = true
  let evidenceReads = 0
  let inventoryReads = 0
  let sourceSends = 0
  const broker = researchBroker({
    access: {
      manifest: fixture.manifest,
      scope: {
        actorId: fixture.capture.actor_id,
        targetId: randomUUID(),
        targetContextId: fixture.capture.target_context_id,
        batchId: fixture.manifest.batch_id,
        attemptId: fixture.input.payload.attempt_id,
        commandId: fixture.input.payload.command_id,
        inputSha256: fixture.input.payload.input_sha256,
        sourceUrls: fixture.manifest.source_urls,
      },
      async ensureCurrent(signal) {
        assertResearchActive(signal)
        if (!current) {
          refuseResearch('research_attempt_unavailable')
        }
      },
    },
    receipts: receipts.repository,
    async readEvidence(id) {
      evidenceReads += 1
      const artifact = fixture.artifacts.find((item) => item.versionId === id)
      assert.ok(artifact)
      return artifact.bytes
    },
    async readInventory(request) {
      inventoryReads += 1
      return new Response(
        JSON.stringify({
          pk: request.pk,
          name: 'Observed fixture Part',
          private_token: 'must never leave projection',
        }),
        { headers: { 'content-type': 'application/json' } },
      )
    },
    protectedOrigins: ['https://inventory.example'],
    async resolveSource(hostname) {
      return [{ address: hostname === 'inventory.example' ? '8.8.4.4' : '8.8.8.8', family: 4 }]
    },
    async sourceTransport() {
      sourceSends += 1
      return {
        status: 200,
        mediaType: 'text/plain',
        bytes: Buffer.from('Retained public source bytes'),
      }
    },
  })
  return {
    ...fixture,
    broker,
    receipts,
    revoke: () => {
      current = false
    },
    counts: () => ({ evidenceReads, inventoryReads, sourceSends }),
  }
}

test('staged evidence returns exact PNG/PDF bytes and refuses foreign/hash/size requests before a content read', async () => {
  const fixture = researchInputFixture()
  let reads = 0
  const read = stagedEvidenceReader(fixture.manifest, async (id) => {
    reads += 1
    const artifact = fixture.artifacts.find((item) => item.versionId === id)
    assert.ok(artifact)
    return artifact.bytes
  })
  for (const artifact of fixture.artifacts) {
    const result = await read(
      { version_id: artifact.versionId, sha256: artifact.digest, offset: '0', length: '98304' },
      new AbortController().signal,
    )
    assert.deepEqual(Buffer.from(result.bytes_base64, 'base64'), artifact.bytes)
    assert.equal(result.evidence_id, artifact.evidenceId)
  }
  const artifact = fixture.artifacts[0]
  for (const request of [
    { version_id: randomUUID(), sha256: artifact.digest, offset: '0', length: '1' },
    { version_id: artifact.versionId, sha256: 'a'.repeat(64), offset: '0', length: '1' },
    { version_id: artifact.versionId, sha256: artifact.digest, offset: '0', length: '98305' },
  ]) {
    await assert.rejects(
      read(request, new AbortController().signal),
      /research_(evidence_invalid|capacity)/,
    )
  }
  assert.equal(reads, 2)
  const corrupt = stagedEvidenceReader(fixture.manifest, async () => Buffer.from('altered bytes'))
  await assert.rejects(
    corrupt(
      { version_id: artifact.versionId, sha256: artifact.digest, offset: '0', length: '1' },
      new AbortController().signal,
    ),
    /research_evidence_invalid/,
  )
})

test('semantic inventory projection retains only safe facts and duplicates never repeat a read', async () => {
  const fixture = brokerFixture()
  const key = randomUUID()
  const args = { model: 'part', pk: '9007199254740993' }
  const first = (await fixture.broker.call(
    'lookup_inventory',
    args,
    key,
    new AbortController().signal,
  )) as { receipt: ResearchReceiptDto; observation: { pk: string; label: string } }
  const repeated = await fixture.broker.call(
    'lookup_inventory',
    args,
    key,
    new AbortController().signal,
  )
  assert.deepEqual(repeated, first)
  assert.equal(first.observation.pk, args.pk)
  assert.equal(first.observation.label, 'Observed fixture Part')
  assert.equal(JSON.stringify(first).includes('private_token'), false)
  assert.deepEqual(fixture.counts(), { evidenceReads: 0, inventoryReads: 1, sourceSends: 0 })
  assert.equal(fixture.receipts.publications(), 1)
  await assert.rejects(
    fixture.broker.call(
      'lookup_inventory',
      { model: 'part', pk: '2' },
      key,
      new AbortController().signal,
    ),
    /research_protocol_invalid/,
  )
  await assert.rejects(
    fixture.broker.call('sendStock', {}, randomUUID(), new AbortController().signal),
    /research_tool_refused/,
  )
  assert.equal(fixture.counts().inventoryReads, 1)
})

test('source broker publishes a retained receipt and reads only its exact digest with bounded chunks', async () => {
  const fixture = brokerFixture()
  const fetched = (await fixture.broker.call(
    'fetch_source',
    { url: fixture.manifest.source_urls[0] },
    randomUUID(),
    new AbortController().signal,
  )) as { receipt: ResearchReceiptDto; bytes_base64: string }
  assert.equal(
    Buffer.from(fetched.bytes_base64, 'base64').toString(),
    'Retained public source bytes',
  )
  const chunk = (await fixture.broker.call(
    'read_source',
    { receipt_id: fetched.receipt.id, sha256: fetched.receipt.sha256, offset: '9', length: '6' },
    randomUUID(),
    new AbortController().signal,
  )) as { bytes_base64: string }
  assert.equal(Buffer.from(chunk.bytes_base64, 'base64').toString(), 'public')
  await assert.rejects(
    fixture.broker.call(
      'read_source',
      { receipt_id: fetched.receipt.id, sha256: 'b'.repeat(64), offset: '0', length: '1' },
      randomUUID(),
      new AbortController().signal,
    ),
    /research_receipt_corrupt/,
  )
  assert.equal(fixture.counts().sourceSends, 1)
})

test('revocation and close prevent fresh or cached tool effects and never create an inventory selection', async () => {
  const fixture = brokerFixture()
  const key = randomUUID()
  const args = { model: 'location', pk: '1' }
  await fixture.broker.call('lookup_inventory', args, key, new AbortController().signal)
  fixture.revoke()
  await assert.rejects(
    fixture.broker.call('lookup_inventory', args, key, new AbortController().signal),
    /research_attempt_unavailable/,
  )
  await assert.rejects(
    fixture.broker.call(
      'fetch_source',
      { url: fixture.manifest.source_urls[0] },
      randomUUID(),
      new AbortController().signal,
    ),
    /research_attempt_unavailable/,
  )
  assert.equal(fixture.counts().inventoryReads, 1)
  assert.equal(fixture.counts().sourceSends, 0)
  assert.equal(fixture.capture.lots[0].quantity.mode, 'set')
  assert.deepEqual(fixture.capture.lots[0].quantity, { mode: 'set', value: '17.000001' })
  fixture.broker.close()
  await assert.rejects(
    fixture.broker.call('lookup_inventory', args, randomUUID(), new AbortController().signal),
    /research_cancelled/,
  )
})

test('tool budget rejects a thirty-third new call without performing an extra content read', async () => {
  const fixture = brokerFixture()
  const artifact = fixture.artifacts[0]
  const args = { version_id: artifact.versionId, sha256: artifact.digest, offset: '0', length: '1' }
  for (let index = 0; index < 32; index += 1) {
    await fixture.broker.call('read_evidence', args, randomUUID(), new AbortController().signal)
  }
  await assert.rejects(
    fixture.broker.call('read_evidence', args, randomUUID(), new AbortController().signal),
    /research_capacity/,
  )
  assert.equal(fixture.counts().evidenceReads, 32)
})
