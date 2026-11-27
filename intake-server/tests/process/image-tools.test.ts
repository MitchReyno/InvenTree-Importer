import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createDecoderDispatcher } from '#/media/decoder-dispatcher.ts'
import { launchDecoder } from '#/media/docker-decoder.ts'
import { isolatedImageOperations } from '#/agents/tools/image-tools.ts'
import { sessionTools, type SessionToolOutput } from '#/agents/tools/handlers.ts'
import { startSessionToolServer } from '#/agents/tools/server.ts'
import { runSessionTurn } from '#/agents/session/session-runner.ts'
import { isolatedViewRenderer } from '#/media/figure-render-consumer.ts'
import { renderFigureStep, sweepFigureRenders } from '#/media/figure-renders.ts'
import { readImagesReview } from '#/processing/images-review.ts'
import { formedBatch } from '../support/lot-pipeline.ts'
import { running } from '../support/stage-sessions.ts'

const image = process.env.INTAKE_MEDIA_DECODER_IMAGE
const skip = image ? false : 'Set INTAKE_MEDIA_DECODER_IMAGE to the explicitly built owned image'
const DAY_MS = 24 * 60 * 60 * 1000

/** The deployed dispatcher protocol against the pinned decoder, on a private test socket. */
async function startDispatcher(pinned: string) {
  const directory = await mkdtemp('/tmp/it-dispatch-')
  const socket = join(directory, 'worker.sock')
  let launched = 0
  const server = createDecoderDispatcher(pinned, 1, async (decoder, packet) => {
    launched++
    return launchDecoder(decoder, packet)
  })
  server.listen(socket)
  await once(server, 'listening')
  return {
    socket,
    launched: () => launched,
    async close() {
      server.close()
      server.closeAllConnections()
      await rm(directory, { recursive: true, force: true })
    },
  }
}

function accepted(output: SessionToolOutput) {
  assert.equal(output.result.ok, true, JSON.stringify(output.result))
  return output
}

test(
  'image tools and an Images session run through the dispatcher, and the sweep keeps proposed crops',
  { skip, timeout: 600_000 },
  async (t) => {
    const dispatcher = await startDispatcher(image!)
    process.env.INTAKE_MEDIA_DISPATCH_SOCKET = dispatcher.socket
    t.after(async () => {
      delete process.env.INTAKE_MEDIA_DISPATCH_SOCKET
      await dispatcher.close()
    })
    const batch = await formedBatch(t, { stageInputs: true, images: true })
    const { fixture } = batch
    const operations = isolatedImageOperations(image!)
    const session = sessionTools({
      pool: fixture.runner.pool,
      writerPool: fixture.writer.pool,
      config: fixture.config,
      store: batch.store,
      statusIntervalMs: 0,
      imageBudget: new Map(),
      deliveredMedia: new Map(),
      imageOperations: operations,
    })
    const lot = await batch.lot('16 mhz crystal')
    const jobs = await batch.successors(lot.id)
    const images = jobs.find((row) => row.stage === 'images')!
    const research = jobs.find((row) => row.stage === 'research')!
    const photo = (
      await fixture.db.pool.query<{ evidence_id: string; id: string; digest: string }>(
        `SELECT evidence_id, id, encode(blob_digest,'hex') AS digest FROM media_version
          WHERE batch_id=$1 AND kind='original'`,
        [batch.batchId],
      )
    ).rows[0]
    // The synthetic Images session publishes through the worker's tool server.
    const server = await startSessionToolServer({
      ...batch.serverOptions,
      imageOperations: operations,
    })
    t.after(() => server.close())
    await runSessionTurn(
      { ...batch.deps, toolUrl: server.url },
      images.attempt_id,
      new AbortController().signal,
    )
    const review = await readImagesReview(fixture.api.pool, fixture.config, batch.batchId)
    const published = review.proposals.find((proposal) => proposal.lot_id === lot.id)
    assert.ok(published, 'the Images session published images/1')
    assert.deepEqual(
      published.crops.map((crop) => crop.state),
      ['preparing'],
    )

    const recipe = {
      version: 'bench-intake-view/2',
      source_version_id: photo.id,
      source_digest: photo.digest,
      page: 1,
      page_width: 768,
      page_height: 512,
      view: {
        region: { x: 100, y: 50, width: 300, height: 200 },
        quarter_turns: 1,
        straighten_millidegrees: -3500,
      },
      light: {
        white_balance: true,
        contrast_clip_permille: null,
        gamma_thousandths: null,
        sharpen: false,
      },
    }

    const imager = await running(fixture, images.attempt_id)
    // Each tool's operation crosses the dispatcher into the pinned decoder.
    accepted(await session.inspect_region(imager, { evidence_id: photo.evidence_id }))
    const preview = accepted(
      await session.preview_images(imager, { crops: [{ label: 'part', recipe }] }),
    )
    assert.equal((preview.result as { crops: { state: string }[] }).crops[0].state, 'rendered')
    accepted(
      await session.match_logo(await running(fixture, research.attempt_id), {
        evidence_id: photo.evidence_id,
        view: recipe.view,
      }),
    )
    // The session's preview, then these three.
    assert.equal(dispatcher.launched(), 4)

    // Its crop renders through the dispatcher, and a day later the sweep keeps it.
    const binding = {
      actorId: fixture.config.actorId,
      targetId: fixture.config.targetId,
      targetContextId: fixture.config.targetContextId,
    }
    assert.equal(
      await renderFigureStep(fixture.db.pool, batch.store!, binding, isolatedViewRenderer(image!)),
      'rendered',
    )
    const later = () => new Date(Date.now() + 2 * DAY_MS)
    const swept = await sweepFigureRenders(fixture.db.pool, batch.store!, binding, later)
    assert.equal(swept.deleted, 0)
    const after = await readImagesReview(fixture.api.pool, fixture.config, batch.batchId)
    assert.deepEqual(
      after.proposals
        .find((proposal) => proposal.lot_id === lot.id)!
        .crops.map((crop) => crop.state),
      ['ready'],
    )
  },
)
