import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { validate } from '@invimport/contracts'
import { processingFixture } from '../support/processing.ts'
import { lotSession, leadSession, seedPhoto } from '../support/sessions.ts'
import { BlobStore } from '#/media/blob-store.ts'
import { readMediaStoreIdentity } from '#/media/store-identity.ts'
import { transaction } from '#/db/database.ts'
import { issueSessionCapability, revokeSessionCapability } from '#/agents/tools/capability.ts'
import { sessionTools, SESSION_IMAGE_BUDGET_BYTES } from '#/agents/tools/handlers.ts'

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

for (const mode of ['manifest', 'notice', 'lead'] as const) {
  test(`${mode}: fetched source cites original bytes and needs actual delivery`, async () => {
    const fixture = await processingFixture()
    const root = await realpath(await mkdtemp(join(tmpdir(), 'citation-test-')))
    try {
      const capture = await fixture.seedCapture()
      const original = await sharp({
        create: { width: 64, height: 48, channels: 3, background: 'red' },
      })
        .png()
        .toBuffer()
      const preview = await sharp(original).resize(32, 24).png().toBuffer()
      const store = await BlobStore.initialize(
        join(root, 'blobs'),
        await readMediaStoreIdentity(fixture.db.pool),
      )
      await transaction(fixture.db.pool, async (client) => {
        await store.publish(client, original)
        await store.publish(client, preview)
      })
      const photo = await seedPhoto(
        fixture,
        capture.batch.id,
        { width: 32, height: 24 },
        'Test photo',
        0,
        { original, preview },
      )
      if (mode === 'manifest') {
        await fixture.db.pool.query(
          'INSERT INTO media_subject_link(id,batch_id,evidence_id,subject_id,linked,revision,actor_id) VALUES($1,$2,$3,$4,true,1,$5)',
          [
            randomUUID(),
            capture.batch.id,
            photo.evidence,
            capture.packetA.id,
            fixture.identity.actor,
          ],
        )
      }
      const session =
        mode === 'lead'
          ? await leadSession(fixture, capture)
          : await lotSession(fixture, capture, capture.packetA)
      if (mode !== 'manifest') {
        await fixture.db.pool.query(
          "INSERT INTO agent_session_inbox(id,session_lineage_id,seq,kind,payload,idempotency_key) VALUES($1,$2,1,'evidence',$3,$4)",
          [
            randomUUID(),
            session.job,
            { evidence_id: photo.evidence, version_id: photo.version },
            photo.version,
          ],
        )
      }
      const token = await transaction(fixture.runner.pool, (client) =>
        issueSessionCapability(client, session.attempt),
      )
      const context = {
        pool: fixture.runner.pool,
        config: fixture.config,
        store,
        statusIntervalMs: 0,
        imageBudget: new Map<string, number>(),
        deliveredMedia: new Map<string, Set<string>>(),
        cropCacheDir: join(root, 'crops'),
      }
      const tools = sessionTools(context)
      const args = { evidence_id: photo.evidence, version_id: photo.version }
      const source = {
        kind: 'media_version' as const,
        evidence_id: photo.evidence,
        version_id: photo.version,
        sha256: digest(original),
      }
      const proposal = (cited = source) => ({
        proposal: {
          schema_version: 'bench-intake-proposal/5',
          subject_id: capture.packetA.id,
          summary: 'Quantity from the picture',
          sources: [cited],
          quantity: { value: '20', status: 'estimated' },
          relies_on: { fields: ['quantity'], sources: [cited] },
        },
      })
      assert.equal((await tools.propose(token, proposal())).result.ok, false)
      const fetched = await tools.fetch_evidence(token, args)
      validate('SessionToolResult', fetched.result)
      assert.equal(fetched.images?.length, 1)
      assert.ok(fetched.result.ok)
      if (!fetched.result.ok) {
        throw new Error('expected fetched evidence')
      }
      assert.deepEqual(fetched.result.source, source)
      assert.notEqual(source.sha256, digest(preview))
      const wrong = await tools.propose(token, proposal({ ...source, sha256: digest(preview) }))
      assert.deepEqual(
        [wrong.result.ok, !wrong.result.ok && wrong.result.error],
        [false, 'source_not_delivered'],
      )
      assert.equal((await tools.propose(token, proposal())).result.ok, true)
      const restarted = sessionTools({ ...context, deliveredMedia: new Map() })
      assert.equal((await restarted.propose(token, proposal())).result.ok, false)
      context.imageBudget.set(digest(Buffer.from(token)), SESSION_IMAGE_BUDGET_BYTES)
      const exhausted = await restarted.fetch_evidence(token, args)
      assert.equal(exhausted.images, undefined)
      assert.ok(exhausted.result.ok && exhausted.result.source === undefined)
      context.imageBudget.clear()
      const cropped = await restarted.fetch_evidence(token, {
        ...args,
        page: 1,
        region: { x: 0, y: 0, width: 16, height: 12, source_width: 32, source_height: 24 },
      })
      assert.ok(cropped.result.ok)
      if (cropped.result.ok) {
        assert.deepEqual(cropped.result.source, source)
      }
      assert.equal(cropped.images?.length, 1)
      assert.equal((await restarted.propose(token, proposal())).result.ok, true)
      const read = await fixture.http(`/batches/${capture.batch.id}/processing`)
      assert.equal(read.status, 200, 'a delivered citation keeps Processing readable')
      if (mode === 'notice') {
        const emptyStore = await BlobStore.initialize(
          join(root, 'empty-blobs'),
          await readMediaStoreIdentity(fixture.db.pool),
        )
        const missingContext = {
          ...context,
          store: emptyStore,
          imageBudget: new Map(),
          deliveredMedia: new Map(),
        }
        const missing = sessionTools(missingContext)
        await assert.rejects(missing.fetch_evidence(token, args))
        assert.equal(missingContext.deliveredMedia.size, 0)
        const foreign = await fixture.seedCapture()
        const foreignPhoto = await seedPhoto(
          fixture,
          foreign.batch.id,
          { width: 32, height: 24 },
          'Other batch',
          0,
          { original, preview },
        )
        await fixture.db.pool.query(
          "INSERT INTO agent_session_inbox(id,session_lineage_id,seq,kind,payload,idempotency_key) VALUES($1,$2,2,'evidence',$3,$4)",
          [
            randomUUID(),
            session.job,
            { evidence_id: foreignPhoto.evidence, version_id: foreignPhoto.version },
            foreignPhoto.version,
          ],
        )
        const foreignResult = await tools.fetch_evidence(token, {
          evidence_id: foreignPhoto.evidence,
          version_id: foreignPhoto.version,
        })
        assert.equal(foreignResult.result.ok, false)
        assert.equal(context.deliveredMedia.get(session.job)?.has(foreignPhoto.version), false)
      }
      const outside = await tools.fetch_evidence(token, {
        evidence_id: randomUUID(),
        version_id: photo.version,
      })
      assert.equal(outside.result.ok, false)
      if (mode === 'notice') {
        const read = store.read.bind(store)
        store.read = async (sha: string) => {
          const bytes = await read(sha)
          await transaction(fixture.runner.pool, (client) =>
            revokeSessionCapability(client, session.attempt),
          )
          return bytes
        }
        const revokedContext = { ...context, imageBudget: new Map(), deliveredMedia: new Map() }
        const revoked = await sessionTools(revokedContext).fetch_evidence(token, args)
        assert.equal(revoked.result.ok, false)
        assert.equal(revoked.images, undefined)
        assert.equal(revokedContext.deliveredMedia.size, 0)
      }
    } finally {
      await fixture.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
}
