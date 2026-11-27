import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
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
import { editMedia } from '#/media/edit.ts'
import { grantMedia } from '#/media/grants.ts'

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
  // Its quantity question may be asked or, when another covers it, returned instead.
  const state = await runSessionTurn(deps, images.attemptId, new AbortController().signal)
  assert.ok(state === 'waiting_input' || state === 'finished', state)
  const review = await readImagesReview(batch.fixture.api.pool, batch.fixture.config, batch.batchId)
  const mine = review.proposals.filter((item) => item.lot_id === images.lot.id)
  assert.equal(mine.length, 1)
  assert.deepEqual(
    mine[0].crops.map((crop) => crop.role),
    ['stock_image'],
  )
})

/** Removes the batch's photo as the operator would, through the media edit. */
async function removePhoto(batch: Batch) {
  const { fixture, batchId } = batch
  await grantMedia(fixture.db.pool, fixture.api.name, 'api')
  const media = await fixture.db.pool.query<{ revision: string }>(
    'SELECT revision::text FROM media_batch WHERE batch_id=$1',
    [batchId],
  )
  await editMedia(fixture.api.pool, fixture.config, batchId, randomUUID(), {
    expected_revision: media.rows[0].revision,
    change: { kind: 'remove', evidence_ids: [(await photo(batch)).evidence_id] },
  })
}

test('an image rendered while its photo was removed is not returned', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true, images: true })
  const source = await photo(batch)
  const real = childImageOperations()
  let release: () => void = () => {}
  const started = new Promise<void>((resolve) => {
    release = resolve
  })
  let rendering: () => void = () => {}
  const isRendering = new Promise<void>((resolve) => {
    rendering = resolve
  })
  const paused: SessionImageOperations = {
    ...real,
    grid: async (input) => {
      rendering()
      await started
      return real.grid(input)
    },
  }
  const session = tools(batch, paused)
  const images = await stageJob(batch, '16 mhz crystal', 'images')
  const imager = await running(batch.fixture, images.attemptId)
  const call = session.inspect_region(imager, { evidence_id: source.evidence_id })
  await isRendering
  await removePhoto(batch)
  release()
  const output = await call
  assert.equal((output.result as Result).error, 'media_evidence_removed')
  assert.equal(output.images, undefined)
})

test('propose_images refuses a photo outside the lot now, and a recipe given twice', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true, images: true })
  const { fixture } = batch
  const session = tools(batch, childImageOperations())
  const images = await stageJob(batch, '16 mhz crystal', 'images')
  const cited = await fetched(batch, session, images.attemptId)
  const source = await photo(batch)
  const imager = await running(fixture, images.attemptId)
  const base = {
    schema_version: 'images/1',
    subject_id: images.lot.id,
    summary: 'The crystal.',
    sources: [cited],
    relies_on: { fields: ['identity'], sources: [cited] },
  }
  const twice = await result(
    session.propose_images(imager, {
      proposal: {
        ...base,
        images: [
          { role: 'part_image', recipe: recipe(source) },
          { role: 'stock_image', recipe: recipe(source) },
        ],
      },
    }),
  )
  assert.equal(twice.error, 'validation_failed')
  assert.equal(twice.issues?.[0].path, '/proposal/images/1/recipe')

  // A second recipe on the same page is checked too, not only the first to name it.
  const second = await result(
    session.propose_images(imager, {
      proposal: {
        ...base,
        images: [
          { role: 'part_image', recipe: recipe(source) },
          {
            role: 'stock_image',
            recipe: { ...recipe(source, { x: 0, y: 0, width: 50, height: 50 }), page_width: 700 },
          },
        ],
      },
    }),
  )
  assert.equal(second.error, 'validation_failed')
  assert.equal(second.issues?.[0].path, '/proposal/images/1/recipe/page_width')

  // The photo leaves the lot: its observations move out, so it is no longer in the lot's scope.
  await fixture.db.pool
    .query(
      `UPDATE capture_lot_evidence_observation SET status='suggested'
      WHERE batch_id=$1 AND lot_id=$2`,
      [batch.batchId, images.lot.id],
    )
    .catch(() => undefined)
  await fixture.db.pool
    .query(`DELETE FROM capture_lot_evidence_observation WHERE batch_id=$1 AND lot_id=$2`, [
      batch.batchId,
      images.lot.id,
    ])
    .catch(() => undefined)
  const moved = await result(
    session.propose_images(imager, {
      proposal: { ...base, images: [{ role: 'stock_image', recipe: recipe(source) }] },
    }),
  )
  assert.equal(moved.error, 'source_not_delivered')
  assert.equal(moved.issues?.[0].rule, 'lot_scope')
})

test('a spent image budget refuses before the decoder runs', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true, images: true })
  const calls: string[] = []
  const images = await stageJob(batch, '16 mhz crystal', 'images')
  const imager = await running(batch.fixture, images.attemptId)
  const spent = tools(
    batch,
    childImageOperations(calls),
    new Map([[sha256Run(imager), 8 * 1024 * 1024]]),
  )
  const over = await result(
    spent.inspect_region(imager, { evidence_id: (await photo(batch)).evidence_id }),
  )
  assert.equal(over.error, 'capacity_reached')
  assert.deepEqual(calls, [])
})

test('a crop’s photo must be cited, and removing it stales the proposal', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true, images: true })
  const { fixture } = batch
  const session = tools(batch, childImageOperations())
  const images = await stageJob(batch, '16 mhz crystal', 'images')
  const cited = await fetched(batch, session, images.attemptId)
  const source = await photo(batch)
  const imager = await running(fixture, images.attemptId)
  const note = (
    await fixture.db.pool.query<{ id: string; text: string }>(
      'SELECT id, text FROM media_evidence_note WHERE batch_id=$1',
      [batch.batchId],
    )
  ).rows[0]
  const noteSource = {
    kind: 'note',
    note_id: note.id,
    text_sha256: createHash('sha256').update(note.text).digest('hex'),
  }
  const proposal = (sources: unknown[]) => ({
    schema_version: 'images/1',
    subject_id: images.lot.id,
    summary: 'The crystal.',
    sources,
    relies_on: { fields: ['identity'], sources },
    images: [{ role: 'stock_image', recipe: recipe(source) }],
  })
  const uncited = await result(session.propose_images(imager, { proposal: proposal([noteSource]) }))
  assert.equal(uncited.error, 'validation_failed')
  assert.equal(uncited.issues?.[0].path, '/proposal/images/0/recipe/source_version_id')

  const published = await result(session.propose_images(imager, { proposal: proposal([cited]) }))
  assert.equal(published.ok, true, JSON.stringify(published))
  await removePhoto(batch)
  const stale = await fixture.db.pool.query<{ reason: string }>(
    'SELECT reason FROM processing_proposal_stale WHERE proposal_id=$1',
    [published.id],
  )
  assert.equal(stale.rows[0]?.reason, 'evidence_removed')
  const review = await readImagesReview(fixture.api.pool, fixture.config, batch.batchId)
  const shown = review.proposals.find((item) => item.proposal_id === published.id)!
  assert.equal(shown.stale, true)
  assert.deepEqual(
    shown.crops.map((crop) => crop.state),
    ['removed'],
  )
})

test('a label the decoder would count as too long is refused before rendering', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true, images: true })
  const calls: string[] = []
  const session = tools(batch, childImageOperations(calls))
  const images = await stageJob(batch, '16 mhz crystal', 'images')
  const imager = await running(batch.fixture, images.attemptId)
  const source = await photo(batch)
  const label = '🔧'.repeat(21)
  const grid = await result(
    session.inspect_region(imager, {
      evidence_id: source.evidence_id,
      boxes: [{ name: label, box: { x: 0, y: 0, width: 10, height: 10 } }],
    }),
  )
  assert.equal(grid.error, 'validation_failed')
  assert.equal(grid.issues?.[0].path, '/boxes/0/name')
  const preview = await result(
    session.preview_images(imager, { crops: [{ label, recipe: recipe(source) }] }),
  )
  assert.equal(preview.error, 'validation_failed')
  assert.deepEqual(calls, [])
})

test('a worker runs a bounded number of image tool calls; another is refused before reading pages', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true, images: true })
  const real = childImageOperations()
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let entered = 0
  const holding: SessionImageOperations = {
    ...real,
    grid: async (input) => {
      entered += 1
      await held
      return real.grid(input)
    },
  }
  const reads: string[] = []
  const store = batch.store!
  const counting = Object.create(store) as typeof store
  counting.read = async (digest: string) => {
    reads.push(digest)
    return store.read(digest)
  }
  const session = sessionTools({
    pool: batch.fixture.runner.pool,
    writerPool: batch.fixture.writer.pool,
    config: batch.fixture.config,
    store: counting,
    statusIntervalMs: 0,
    imageBudget: new Map(),
    deliveredMedia: new Map(),
    imageOperations: holding,
    imageToolsRunning: { count: 0 },
  })
  const images = await stageJob(batch, '16 mhz crystal', 'images')
  const imager = await running(batch.fixture, images.attemptId)
  const source = await photo(batch)
  const first = session.inspect_region(imager, { evidence_id: source.evidence_id })
  const second = session.inspect_region(imager, { evidence_id: source.evidence_id })
  for (let tries = 0; entered < 2 && tries < 200; tries += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.equal(entered, 2)
  const readsBefore = reads.length
  const third = await result(session.inspect_region(imager, { evidence_id: source.evidence_id }))
  assert.equal(third.error, 'capacity_reached')
  assert.equal(reads.length, readsBefore, 'the refused call read no page')
  release()
  assert.equal((await first).result.ok, true)
  assert.equal((await second).result.ok, true)
})

test('a lot’s newer images/1 reads first, ordered by publication, not by clock', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true, images: true })
  const { fixture } = batch
  const session = tools(batch, childImageOperations())
  const images = await stageJob(batch, '16 mhz crystal', 'images')
  const cited = await fetched(batch, session, images.attemptId)
  const source = await photo(batch)
  const imager = await running(fixture, images.attemptId)
  const publish = async (
    summary: string,
    region: { x: number; y: number; width: number; height: number },
  ) =>
    result(
      session.propose_images(imager, {
        proposal: {
          schema_version: 'images/1',
          subject_id: images.lot.id,
          summary,
          sources: [cited],
          relies_on: { fields: ['identity'], sources: [cited] },
          images: [{ role: 'stock_image', recipe: recipe(source, region) }],
        },
      }),
    )
  const first = await publish('First crop.', { x: 0, y: 0, width: 100, height: 100 })
  const second = await publish('Corrected crop.', { x: 10, y: 10, width: 100, height: 100 })
  // Even with the clock showing them out of order, publication order decides.
  await fixture.db.pool.query(
    'ALTER TABLE agent_session_outbox DISABLE TRIGGER agent_session_outbox_immutable',
  )
  await fixture.db.pool.query(
    `UPDATE agent_session_outbox SET created_at = CASE WHEN payload->>'proposal_id'=$1
       THEN now() + interval '1 hour' ELSE now() END
     WHERE kind='proposal' AND payload->>'proposal_id' IN ($1,$2)`,
    [first.id, second.id],
  )
  await fixture.db.pool.query(
    'ALTER TABLE agent_session_outbox ENABLE TRIGGER agent_session_outbox_immutable',
  )
  const review = await readImagesReview(fixture.api.pool, fixture.config, batch.batchId)
  const mine = review.proposals.filter((item) => item.lot_id === images.lot.id)
  assert.deepEqual(
    mine.map((item) => item.proposal_id),
    [second.id, first.id],
  )
})
