import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import type { MediaLitViewRecipeDto } from '@invimport/contracts'
import { formedBatch } from '../support/lot-pipeline.ts'
import { running, withClients, type StageToolResult } from '../support/stage-sessions.ts'
import { childImageOperations } from '../support/decoder-child.ts'
import { sessionTools, type SessionToolOutput } from '#/agents/tools/handlers.ts'
import { startSessionToolServer } from '#/agents/tools/server.ts'
import { recordPhotoRelease } from '#/agents/tools/photo-release.ts'
import { runSessionTurn } from '#/agents/session/session-runner.ts'
import { readImagesReview } from '#/processing/images-review.ts'
import { renderFigureStep } from '#/media/figure-renders.ts'
import type { SessionImageOperations } from '#/agents/tools/image-tools.ts'

type Batch = Awaited<ReturnType<typeof formedBatch>>
type Result = StageToolResult

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

function tools(batch: Batch, operations?: SessionImageOperations, imageBudget = new Map()) {
  return sessionTools({
    pool: batch.fixture.runner.pool,
    writerPool: batch.fixture.writer.pool,
    config: batch.fixture.config,
    store: batch.store,
    statusIntervalMs: 0,
    imageBudget,
    deliveredMedia: new Map(),
    figurePreviewWaitMs: 0,
    imageOperations: operations,
  })
}

async function result(output: Promise<SessionToolOutput>) {
  return (await output).result as Result
}

/** The lot's stage job and its current attempt. */
async function stageJob(batch: Batch, label: string, stage: 'research' | 'images') {
  const lot = await batch.lot(label)
  const row = (await batch.successors(lot.id)).find((item) => item.stage === stage)!
  return { lot, jobId: row.job_id, attemptId: row.attempt_id }
}

/** The batch's one photo, as a recipe names it. */
async function photo(batch: Batch) {
  const rows = await batch.fixture.db.pool.query<{
    evidence_id: string
    id: string
    digest: string
    width: number
    height: number
  }>(
    `SELECT v.evidence_id, v.id, encode(v.blob_digest,'hex') AS digest, p.width, p.height
       FROM media_version v JOIN media_preview p ON p.version_id=v.id AND p.page=1
      WHERE v.batch_id=$1 AND v.kind='original'`,
    [batch.batchId],
  )
  return rows.rows[0]
}

function recipe(
  source: Awaited<ReturnType<typeof photo>>,
  region = { x: 100, y: 50, width: 300, height: 200 },
  view: Partial<MediaLitViewRecipeDto['view']> = {},
): MediaLitViewRecipeDto {
  return {
    version: 'bench-intake-view/2',
    source_version_id: source.id,
    source_digest: source.digest,
    page: 1,
    page_width: source.width,
    page_height: source.height,
    view: { region, quarter_turns: 1, straighten_millidegrees: 3500, ...view },
    light: {
      white_balance: false,
      contrast_clip_permille: null,
      gamma_thousandths: null,
      sharpen: false,
    },
  }
}

/** Fetches the photo for the session and records its release, so the session may cite it. */
async function fetched(batch: Batch, session: ReturnType<typeof tools>, attempt: string) {
  const source = await photo(batch)
  const shown = await result(
    session.fetch_evidence(await running(batch.fixture, attempt), {
      evidence_id: source.evidence_id,
      version_id: source.id,
    }),
  )
  assert.equal(shown.ok, true, JSON.stringify(shown))
  await recordPhotoRelease(batch.fixture.runner.pool, attempt, String(shown.view_seq))
  return shown.source!
}

test('each /7 stage is offered only its own image tools', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true, images: true })
  const research = await stageJob(batch, '16 mhz crystal', 'research')
  const images = await stageJob(batch, '16 mhz crystal', 'images')
  const names = async (attempt: string) => {
    let listed: string[] = []
    await withClients(async (open) => {
      const client = await open(batch.server.url, await running(batch.fixture, attempt))
      listed = (await client.listTools()).tools.map((tool) => tool.name).sort()
    })
    return listed
  }
  const common = ['ask', 'fetch_evidence', 'propose', 'read_guide', 'read_inbox', 'reply', 'status']
  assert.deepEqual(
    await names(images.attemptId),
    [...common, 'inspect_region', 'preview_images', 'propose_images', 'read_lot'].sort(),
  )
  assert.deepEqual(
    await names(research.attemptId),
    [...common, 'match_logo', 'read_lot', 'read_vocabulary'].sort(),
  )
  const lead = await names(batch.leadAttempt)
  assert.ok(lead.includes('inspect_region') && lead.includes('match_logo'))
  assert.ok(!lead.includes('preview_images') && !lead.includes('propose_images'))
})

test('inspect_region, preview_images and match_logo return the decoder image within the budget', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true, images: true })
  const calls: string[] = []
  const session = tools(batch, childImageOperations(calls))
  const images = await stageJob(batch, '16 mhz crystal', 'images')
  const research = await stageJob(batch, '16 mhz crystal', 'research')
  const imager = await running(batch.fixture, images.attemptId)
  const source = await photo(batch)

  const grid = await session.inspect_region(imager, {
    evidence_id: source.evidence_id,
    region: { x: 100, y: 50, width: 300, height: 200 },
    preview_width: 600,
    boxes: [{ name: 'part', box: { x: 150, y: 80, width: 120, height: 120 } }],
  })
  assert.equal(grid.result.ok, true, JSON.stringify(grid.result))
  const gridResult = grid.result as Result
  assert.deepEqual(gridResult.grid!.region, { x: 100, y: 50, width: 300, height: 200 })
  assert.equal(gridResult.grid!.boxes[0].name, 'part')
  assert.equal(grid.images?.length, 1)
  const gridBytes = Buffer.from(grid.images![0].base64, 'base64')
  assert.equal(gridResult.images![0].sha256, sha(gridBytes))
  assert.equal((await sharp(gridBytes).metadata()).width, gridResult.images![0].width)

  const preview = await session.preview_images(imager, {
    crops: [
      { label: 'part', recipe: recipe(source) },
      {
        label: 'bag',
        recipe: recipe(
          source,
          { x: 0, y: 0, width: 768, height: 512 },
          { quarter_turns: 0, straighten_millidegrees: 0 },
        ),
      },
    ],
  })
  assert.equal(preview.result.ok, true, JSON.stringify(preview.result))
  const crops = (preview.result as Result).crops!
  assert.deepEqual(
    crops.map((crop) => [crop.label, crop.state]),
    [
      ['part', 'rendered'],
      ['bag', 'rendered'],
    ],
  )
  assert.equal(preview.images?.length, 1)

  // Research matches logos but has no grid, preview or proposal of images.
  const researcher = await running(batch.fixture, research.attemptId)
  const logo = await session.match_logo(researcher, {
    evidence_id: source.evidence_id,
    view: {
      region: { x: 100, y: 50, width: 300, height: 200 },
      quarter_turns: 0,
      straighten_millidegrees: 0,
    },
    top: 3,
  })
  assert.equal(logo.result.ok, true, JSON.stringify(logo.result))
  assert.ok(Array.isArray((logo.result as Result).candidates))
  assert.equal(logo.images?.length, 1)
  const refused = await result(
    session.preview_images(researcher, { crops: [{ label: 'x', recipe: recipe(source) }] }),
  )
  assert.equal(refused.error, 'tool_not_allowed')
  assert.deepEqual(calls, ['grid', 'preview', 'logo'])

  // A run whose image budget is spent gets no image, and the decoder isn't asked again for it.
  const spent = tools(
    batch,
    childImageOperations(),
    new Map([[sha256Run(imager), 8 * 1024 * 1024]]),
  )
  const over = await result(spent.inspect_region(imager, { evidence_id: source.evidence_id }))
  assert.equal(over.error, 'capacity_reached')
})

function sha256Run(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

test('image tools refuse what the session was not given, or a recipe that does not fit', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true, images: true })
  const calls: string[] = []
  const session = tools(batch, childImageOperations(calls))
  const images = await stageJob(batch, '16 mhz crystal', 'images')
  const imager = await running(batch.fixture, images.attemptId)
  const source = await photo(batch)

  const unknown = await result(
    session.inspect_region(imager, { evidence_id: '00000000-0000-4000-8000-0000000000aa' }),
  )
  assert.equal(unknown.error, 'source_not_delivered')
  const outside = await result(
    session.inspect_region(imager, {
      evidence_id: source.evidence_id,
      region: { x: 700, y: 0, width: 100, height: 100 },
    }),
  )
  assert.equal(outside.error, 'validation_failed')
  const wrongDigest = await result(
    session.preview_images(imager, {
      crops: [{ label: 'x', recipe: { ...recipe(source), source_digest: 'a'.repeat(64) } }],
    }),
  )
  assert.equal(wrongDigest.error, 'validation_failed')
  assert.equal(wrongDigest.issues?.[0].path, '/crops/0/recipe/source_digest')
  const wrongSize = await result(
    session.preview_images(imager, {
      crops: [{ label: 'x', recipe: { ...recipe(source), page_width: 769 } }],
    }),
  )
  assert.equal(wrongSize.error, 'validation_failed')
  const offPage = await result(
    session.preview_images(imager, {
      crops: [
        {
          label: 'x',
          recipe: recipe(
            source,
            { x: 700, y: 400, width: 100, height: 112 },
            { straighten_millidegrees: 0 },
          ),
        },
      ],
    }),
  )
  assert.equal(offPage.error, 'validation_failed')
  assert.deepEqual(calls, [])

  // Without the decoder operations the tools are unavailable, not silently empty.
  const without = await result(
    tools(batch).inspect_region(imager, { evidence_id: source.evidence_id }),
  )
  assert.equal(without.error, 'tool_failed')
})

test('propose_images publishes images/1 and queues the app’s rendering of each crop', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true, images: true })
  const { fixture } = batch
  const session = tools(batch, childImageOperations())
  const images = await stageJob(batch, '16 mhz crystal', 'images')
  const research = await stageJob(batch, '16 mhz crystal', 'research')
  const cited = await fetched(batch, session, images.attemptId)
  const source = await photo(batch)
  const imager = await running(fixture, images.attemptId)
  const proposal = {
    schema_version: 'images/1',
    subject_id: images.lot.id,
    summary: 'The crystal on its own, and the tray.',
    sources: [cited],
    relies_on: { fields: ['identity'], sources: [cited] },
    images: [
      { role: 'part_image', recipe: recipe(source) },
      {
        role: 'stock_image',
        recipe: recipe(
          source,
          { x: 0, y: 0, width: 768, height: 512 },
          { quarter_turns: 0, straighten_millidegrees: 0 },
        ),
      },
      {
        role: 'extra',
        recipe: recipe(source, { x: 10, y: 10, width: 100, height: 100 }),
        flags: ['soft'],
      },
    ],
  }

  // A recipe can't carry marks, and only Images proposes images.
  const marked = await result(
    session.propose_images(imager, {
      proposal: {
        ...proposal,
        images: [{ ...proposal.images[0], recipe: { ...proposal.images[0].recipe, marks: [] } }],
      },
    }),
  )
  assert.equal(marked.error, 'validation_failed')
  const byResearch = await result(
    session.propose_images(await running(fixture, research.attemptId), { proposal }),
  )
  assert.equal(byResearch.error, 'tool_not_allowed')
  const otherLot = await result(
    session.propose_images(imager, {
      proposal: { ...proposal, subject_id: (await batch.lot('led 0603 red')).id },
    }),
  )
  assert.equal(otherLot.ok, false)

  const published = await result(session.propose_images(imager, { proposal }))
  assert.equal(published.ok, true, JSON.stringify(published))
  const stored = await fixture.db.pool.query<{
    image_index: number
    purpose: string
    marks: Buffer | null
  }>(
    `SELECT i.image_index, r.purpose, r.marks_bytes AS marks
       FROM processing_proposal_image i
       JOIN processing_figure_render r ON r.recipe_digest=i.recipe_digest
      WHERE i.proposal_id=$1 ORDER BY i.image_index`,
    [published.id],
  )
  // Each crop is an unmarked view render: Images output never has marks drawn in.
  assert.deepEqual(
    stored.rows.map((row) => [row.image_index, row.purpose, row.marks]),
    [
      [1, 'view', null],
      [2, 'view', null],
      [3, 'view', null],
    ],
  )

  const before = await readImagesReview(fixture.api.pool, fixture.config, batch.batchId)
  assert.equal(before.proposals.length, 1)
  assert.equal(before.proposals[0].lot_id, images.lot.id)
  assert.equal(before.proposals[0].stale, false)
  assert.deepEqual(
    before.proposals[0].crops.map((crop) => [crop.index, crop.role, crop.state, crop.flags]),
    [
      [1, 'part_image', 'preparing', []],
      [2, 'stock_image', 'preparing', []],
      [3, 'extra', 'preparing', ['soft']],
    ],
  )

  // Once rendered, the crop's picture is served under the batch's scope.
  const render = async (input: { width: number; height: number }) => {
    const view = await sharp({
      create: { width: 64, height: 48, channels: 3, background: '#406080' },
    })
      .webp()
      .toBuffer()
    const thumb = await sharp({
      create: { width: 32, height: 24, channels: 3, background: '#406080' },
    })
      .webp()
      .toBuffer()
    assert.ok(input.width > 0)
    return {
      state: 'ready' as const,
      view: { bytes: view, width: 64, height: 48 },
      thumb: { bytes: thumb, width: 32, height: 24 },
      preview: null,
    }
  }
  const binding = {
    actorId: fixture.config.actorId,
    targetId: fixture.config.targetId,
    targetContextId: fixture.config.targetContextId,
  }
  for (let step = 0; step < 3; step += 1) {
    assert.equal(await renderFigureStep(fixture.db.pool, batch.store!, binding, render), 'rendered')
  }
  const after = await readImagesReview(fixture.api.pool, fixture.config, batch.batchId)
  assert.deepEqual(
    after.proposals[0].crops.map((crop) => crop.state),
    ['ready', 'ready', 'ready'],
  )
})

test('a synthetic /7 Images session publishes an accepted images/1 through propose_images', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true, images: true })
  const server = await startSessionToolServer({
    ...batch.serverOptions,
    imageOperations: childImageOperations(),
  })
  t.after(() => server.close())
  const images = await stageJob(batch, '16 mhz crystal', 'images')
  const deps = { ...batch.deps, toolUrl: server.url }
  assert.equal(
    await runSessionTurn(deps, images.attemptId, new AbortController().signal),
    'waiting_input',
  )
  const review = await readImagesReview(batch.fixture.api.pool, batch.fixture.config, batch.batchId)
  const mine = review.proposals.filter((item) => item.lot_id === images.lot.id)
  assert.equal(mine.length, 1)
  assert.deepEqual(
    mine[0].crops.map((crop) => crop.role),
    ['stock_image'],
  )
})
