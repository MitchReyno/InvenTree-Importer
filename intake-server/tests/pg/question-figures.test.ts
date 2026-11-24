import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, realpath, rm, stat, utimes } from 'node:fs/promises'
import { PassThrough } from 'node:stream'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { validate, type ProcessingQuestionFigureDto } from '@invimport/contracts'
import { processingFixture } from '../support/processing.ts'
import { lotSession } from '../support/sessions.ts'
import { mediaEditor } from '../support/media-removal.ts'
import {
  fakeRenderer,
  figure,
  figureQuestion,
  linkToLot,
  mediaRole,
  patternedPage,
  processingChanged,
  seedPages,
  storedFigures,
  type FigureSpec,
} from '../support/question-figures.ts'
import { seedAuthority } from '../support/database.ts'
import { BlobStore, lockBlob } from '#/media/blob-store.ts'
import { DecoderDispatcherBusyError, requestDecode } from '#/media/dispatcher-client.ts'
import { readMediaStoreIdentity } from '#/media/store-identity.ts'
import { mediaContent } from '#/media/content.ts'
import { transaction } from '#/db/database.ts'
import { issueSessionCapability } from '#/agents/tools/capability.ts'
import {
  FIGURE_PREVIEW_MAX_BYTES,
  recordMediaDelivery,
  sessionTools,
  type SessionToolContext,
  type SessionToolOutput,
} from '#/agents/tools/handlers.ts'
import { startSessionToolServer } from '#/agents/tools/server.ts'
import {
  enqueueFigureRenders,
  MAX_PENDING_PREVIEWS,
  MAX_RENDER_ATTEMPTS,
  RENDER_LEASE_MS,
  renderFigureStep,
  sweepFigureRenders,
  collectReleasedBlob,
  type RenderView,
} from '#/media/figure-renders.ts'
import { runFigureRenderConsumer } from '#/media/figure-render-consumer.ts'
import { TurnEvidenceReleases } from '#/agents/shared-vm/evidence-release.ts'
import { evidenceRequest } from '#/agents/shared-vm/evidence-request.ts'
import { stageEvidence } from '#/agents/shared-vm/stage-evidence.ts'
import { startMcpProxy } from '#/agents/shared-vm/mcp-proxy.ts'
import { evidenceReplyLimit, Frames } from '#/agents/shared-vm/frames.ts'

type Fixture = Awaited<ReturnType<typeof processingFixture>>
type Setup = Awaited<ReturnType<typeof figureSession>> & { fixture: Fixture; root: string }

const VM_PROFILE = {
  id: 'shared-vm-agent/3' as const,
  agent: { provider: 'codex' as const, authentication: 'subscription' as const, model: 'fixture' },
  settingsRevision: '1',
}

/** `true` for the `shared-vm-agent/3` relay; `'v1'` for the older relay without the larger frame. */
type FigureSessionOptions = { vm?: boolean | 'v1' }

const V1_PROFILE = 'shared-vm-agent/1' as const

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

/**
 * A lot session whose manifest holds a 320 × 240 photo and a two-page document (400 × 300 and
 * 300 × 400), with a third photo outside the manifest for an evidence notice and a fourth the
 * session is never given. The web app serves media, and a media role renders figures.
 */
async function figureSession(fixture: Fixture, root: string, options: FigureSessionOptions = {}) {
  const store = await BlobStore.initialize(
    join(root, 'blobs'),
    await readMediaStoreIdentity(fixture.db.pool),
  )
  await fixture.start({ mediaStore: store })
  const capture = await fixture.seedCapture()
  const batchId = capture.batch.id
  const photo = await seedPages(fixture, store, batchId, {
    label: 'IMG_3020',
    mediaType: 'image/png',
    pages: [await patternedPage(320, 240, 1)],
  })
  const document = await seedPages(fixture, store, batchId, {
    label: 'Datasheet',
    mediaType: 'application/pdf',
    pages: [await patternedPage(400, 300, 2), await patternedPage(300, 400, 3)],
  })
  const noticed = await seedPages(fixture, store, batchId, {
    label: 'IMG_3041',
    mediaType: 'image/png',
    pages: [await patternedPage(240, 180, 4)],
  })
  const never = await seedPages(fixture, store, batchId, {
    label: 'IMG_3099',
    mediaType: 'image/png',
    pages: [await patternedPage(200, 160, 5)],
  })
  await linkToLot(fixture, batchId, photo.evidence, capture.packetA.id, 1)
  await linkToLot(fixture, batchId, document.evidence, capture.packetA.id, 2)
  const session = await lotSession(
    fixture,
    capture,
    capture.packetA,
    options.vm
      ? { profile: { ...VM_PROFILE, id: options.vm === 'v1' ? V1_PROFILE : VM_PROFILE.id } }
      : {},
  )
  const token = await transaction(fixture.runner.pool, (client) =>
    issueSessionCapability(client, session.attempt),
  )
  const context: SessionToolContext = {
    pool: fixture.runner.pool,
    config: fixture.config,
    store,
    evidenceImage: options.vm ? 'original' : undefined,
    statusIntervalMs: 0,
    imageBudget: new Map(),
    deliveredMedia: new Map(),
    cropCacheDir: join(root, 'crops'),
  }
  const media = await mediaRole(fixture)
  const binding = {
    actorId: fixture.config.actorId,
    targetId: fixture.config.targetId,
    targetContextId: fixture.config.targetContextId,
  }
  const lot = capture.packetA.id
  const photoFigure = (extra: Partial<FigureSpec> = {}) =>
    figure({
      evidence_id: photo.evidence,
      version_id: photo.version,
      page: 1,
      region: { x: 40, y: 30, width: 160, height: 120 },
      ...extra,
    })
  const pageTwoFigure = (extra: Partial<FigureSpec> = {}) =>
    figure({
      evidence_id: document.evidence,
      version_id: document.version,
      page: 2,
      region: { x: 20, y: 60, width: 200, height: 150 },
      quarterTurns: 1,
      ...extra,
    })
  return {
    store,
    capture,
    batchId,
    photo,
    document,
    noticed,
    never,
    session,
    token,
    context,
    tools: sessionTools(context),
    media,
    binding,
    lot,
    photoFigure,
    pageTwoFigure,
  }
}

async function withFigureSession(
  run: (setup: Setup) => Promise<void>,
  options: FigureSessionOptions = {},
) {
  const fixture = await processingFixture({ autoStart: false })
  const root = await realpath(await mkdtemp(join(tmpdir(), 'question-figures-')))
  let media: { close: () => Promise<void> } | undefined
  try {
    const setup = await figureSession(fixture, root, options)
    media = setup.media
    await run({ ...setup, fixture, root })
  } finally {
    await media?.close()
    await fixture.dispose()
    await rm(root, { recursive: true, force: true })
  }
}

function refusal(output: SessionToolOutput) {
  validate('SessionToolResult', output.result)
  if (output.result.ok) {
    throw new Error(`expected a refusal: ${JSON.stringify(output.result)}`)
  }
  return output.result
}

function accepted(output: SessionToolOutput) {
  validate('SessionToolResult', output.result)
  if (!output.result.ok) {
    throw new Error(`expected success: ${JSON.stringify(output.result)}`)
  }
  return output.result
}

async function fetched(setup: Setup, evidence: { evidence: string; version: string }, page = 1) {
  return accepted(
    await setup.tools.fetch_evidence(setup.token, {
      evidence_id: evidence.evidence,
      version_id: evidence.version,
      page,
    }),
  )
}

/** A proposal about the lot citing one media version. */
function citing(lot: string, source: Record<string, string>) {
  return {
    proposal: {
      schema_version: 'bench-intake-proposal/5',
      subject_id: lot,
      summary: 'Quantity from the datasheet page',
      sources: [source],
      quantity: { value: '20', status: 'estimated' },
      relies_on: { fields: ['quantity'], sources: [source] },
    },
  }
}

/** Runs the render consumer in this process with an injected renderer until stopped. */
function consumer(setup: Setup, render: RenderView) {
  const stop = new AbortController()
  const running = runFigureRenderConsumer({
    pool: setup.media.pool,
    store: setup.store,
    binding: setup.binding,
    render,
    signal: stop.signal,
    pollMs: 50,
  })
  return async () => {
    stop.abort()
    await running
  }
}

/** The work's outcome, observed from now so a rejection is never unhandled. */
async function outcomeOf<T>(work: Promise<T>): Promise<PromiseSettledResult<T>> {
  const [outcome] = await Promise.allSettled([work])
  return outcome
}

async function renderRows(setup: Setup, purpose: 'view' | 'preview') {
  const rows = await setup.fixture.db.pool.query<{
    id: string
    state: string
    attempts: number
    recipe_digest: Buffer
    xmin: string
  }>(
    `SELECT id, state, attempts, recipe_digest, xmin::text FROM processing_figure_render
     WHERE batch_id=$1 AND purpose=$2 ORDER BY created_at, id`,
    [setup.batchId, purpose],
  )
  return rows.rows
}

/** The view render a stored question's figure shows. */
async function figureRender(setup: Setup, questionId: string, index: number) {
  const rows = await setup.fixture.db.pool.query<{
    id: string
    state: string
    attempts: number
    view: string | null
    thumb: string | null
  }>(
    `SELECT r.id, r.state, r.attempts, encode(r.view_digest,'hex') AS view,
       encode(r.thumb_digest,'hex') AS thumb
     FROM processing_question_figure f
     JOIN processing_figure_render r ON r.purpose='view' AND r.recipe_digest=f.recipe_digest
     WHERE f.question_id=$1 AND f.figure_index=$2`,
    [questionId, index],
  )
  return rows.rows[0]
}

test('figure refusals name the figure and the field, and store nothing', async () => {
  await withFigureSession(async (setup) => {
    const { tools, token, lot, photoFigure, pageTwoFigure } = setup
    const ask = (figures: unknown[]) => tools.ask(token, figureQuestion(lot, figures))

    // A manifest version the session never fetched gives no picture.
    const unfetched = refusal(await ask([photoFigure()]))
    assert.equal(unfetched.error, 'source_not_delivered')
    assert.equal(unfetched.issues?.[0]?.path, '/figures/0/source/version_id')

    await fetched(setup, setup.photo)
    await fetched(setup, setup.document, 2)
    const cases: { name: string; bad: unknown; error: string; path: string }[] = [
      {
        name: 'a version never delivered',
        bad: figure({
          evidence_id: setup.never.evidence,
          version_id: setup.never.version,
          page: 1,
          region: { x: 0, y: 0, width: 50, height: 40 },
        }),
        error: 'source_not_delivered',
        path: '/figures/1/source/version_id',
      },
      {
        name: 'a version named with another evidence item',
        bad: pageTwoFigure({ evidence_id: setup.photo.evidence }),
        error: 'source_not_delivered',
        path: '/figures/1/source',
      },
      {
        name: 'a page the document does not have',
        bad: pageTwoFigure({ page: 3 }),
        error: 'validation_failed',
        path: '/figures/1/source/page',
      },
      {
        name: 'a region outside the page',
        bad: pageTwoFigure({ region: { x: 200, y: 0, width: 150, height: 100 } }),
        error: 'validation_failed',
        path: '/figures/1/view/region',
      },
      {
        name: 'a mark outside the picture',
        bad: {
          ...pageTwoFigure(),
          marks: [{ kind: 'box', geometry: { x: 8000, y: 1000, width: 4000, height: 2000 } }],
        },
        error: 'validation_failed',
        path: '/figures/1/marks/0/geometry',
      },
    ]
    for (const item of cases) {
      const refused = refusal(await ask([photoFigure(), item.bad]))
      assert.equal(refused.error, item.error, item.name)
      assert.equal(refused.issues?.[0]?.path, item.path, item.name)
      assert.match(refused.message, /^Figure 2: /, item.name)
    }

    const six = refusal(
      await ask(Array.from({ length: 6 }, (_, n) => photoFigure({ label: `Mark ${n}` }))),
    )
    assert.equal(six.error, 'validation_failed')
    assert.ok(
      six.issues?.some((issue) => issue.path === '/figures'),
      JSON.stringify(six.issues),
    )
    const nine = refusal(
      await ask([
        photoFigure(),
        {
          ...pageTwoFigure(),
          marks: Array.from({ length: 9 }, (_, n) => ({
            kind: 'label',
            at: { x: 1000, y: n * 1000 },
            label: `Pin ${n + 1}`,
          })),
        },
      ]),
    )
    assert.equal(nine.error, 'validation_failed')
    assert.ok(
      nine.issues?.some((issue) => issue.path === '/figures/1/marks'),
      JSON.stringify(nine.issues),
    )

    assert.deepEqual(await storedFigures(setup.fixture, setup.session.job, setup.batchId), {
      questions: 0,
      figures: 0,
      views: 0,
      previews: 0,
      outbox: 0,
    })

    // A removed photo gives no picture, though the session was given it.
    await mediaEditor(setup.fixture.api.pool, setup.fixture.config, setup.batchId).applied({
      kind: 'remove',
      evidence_ids: [setup.photo.evidence],
    })
    const removed = refusal(await ask([pageTwoFigure(), photoFigure()]))
    assert.equal(removed.error, 'media_evidence_removed')
    assert.equal(removed.issues?.[0]?.path, '/figures/1/source')

    // The same session's valid figure is still accepted, so the refusals were each figure's own.
    accepted(await ask([pageTwoFigure()]))
    const stored = await storedFigures(setup.fixture, setup.session.job, setup.batchId)
    assert.deepEqual([stored.questions, stored.figures, stored.views], [1, 1, 1])
  })
})

test('direct delivery: only the fetched page of a document is figured, and a proposal still cites the version', async () => {
  await withFigureSession(async (setup) => {
    const { tools, token, lot, pageTwoFigure } = setup
    const sent = await fetched(setup, setup.document, 2)
    assert.equal(sent.delivered?.page, 2)

    const otherPage = refusal(
      await tools.ask(
        token,
        figureQuestion(lot, [
          pageTwoFigure(),
          pageTwoFigure({ page: 1, region: { x: 0, y: 0, width: 200, height: 150 } }),
        ]),
      ),
    )
    assert.equal(otherPage.error, 'source_not_delivered')
    assert.equal(otherPage.issues?.[0]?.path, '/figures/1/source/page')

    accepted(await tools.propose(token, citing(lot, setup.document.source)))
    const asked = accepted(await tools.ask(token, figureQuestion(lot, [pageTwoFigure()])))
    assert.ok(asked.id)
  })
})

test('a page an earlier attempt of the job was given is not this conversation’s to show', async () => {
  await withFigureSession(async (setup) => {
    const { tools, token, lot, pageTwoFigure, context } = setup
    // Start fresh keeps the job and starts a new attempt; the old conversation saw page 2.
    recordMediaDelivery(context.deliveredMedia, setup.session.job, setup.document.version, {
      attemptId: randomUUID(),
      page: 2,
    })

    const unseen = refusal(await tools.ask(token, figureQuestion(lot, [pageTwoFigure()])))
    assert.equal(unseen.error, 'source_not_delivered')
    assert.equal(unseen.issues?.[0]?.path, '/figures/0/source/page')

    // This attempt fetching the page itself, in this turn or a resumed one, lets it show it.
    await fetched(setup, setup.document, 2)
    accepted(await tools.ask(token, figureQuestion(lot, [pageTwoFigure()])))
  })
})

for (const delivery of ['file', 'inline'] as const) {
  test(`VM ${delivery} delivery: the release receipt binds the fetched page, and figures wait for its confirmation`, async () => {
    await withFigureSession(
      async (setup) => {
        const { tools, token, lot, pageTwoFigure, context } = setup
        const output = await tools.fetch_evidence(token, {
          evidence_id: setup.document.evidence,
          version_id: setup.document.version,
          page: 2,
        })
        const sent = accepted(output)
        assert.equal(sent.delivered?.page, 2)
        assert.equal(context.deliveredMedia.size, 0, 'the VM path defers the citation')

        const beforeConfirm = refusal(
          await tools.ask(token, figureQuestion(lot, [pageTwoFigure()])),
        )
        assert.equal(beforeConfirm.error, 'source_not_delivered')
        assert.equal(
          refusal(await tools.propose(token, citing(lot, setup.document.source))).error,
          'source_not_delivered',
        )

        // The coordinator keeps a receipt from the trusted reply; the guest stages the image and
        // acknowledges only the opaque release ID.
        const body = JSON.stringify({
          jsonrpc: '2.0',
          id: 7,
          result: {
            content: [
              { type: 'text', text: JSON.stringify(output.result) },
              ...output.images!.map((image) => ({
                type: 'image',
                data: image.base64,
                mimeType: image.mediaType,
              })),
            ],
            structuredContent: output.result,
          },
        })
        const releases = new TurnEvidenceReleases()
        const { releaseId } = releases.prepare(7, body, 'current')
        const staging = await realpath(await mkdtemp(join(setup.root, 'guest-')))
        const staged = JSON.parse(
          await stageEvidence(7, body, async () => staging, delivery, 'current'),
        ).result
        const imageItems = staged.content.filter((item: { type: string }) => item.type === 'image')
        assert.equal(imageItems.length, delivery === 'inline' ? 1 : 0)
        assert.equal(
          digest(await readFile(staged.structuredContent.local_file.path)),
          sent.delivered!.sha256,
        )
        const granted: unknown[] = []
        releases.confirm(releaseId, (release) => {
          granted.push(release)
          recordMediaDelivery(
            context.deliveredMedia,
            setup.session.job,
            release.version,
            release.page === undefined
              ? undefined
              : { attemptId: setup.session.attempt, page: release.page },
          )
        })
        assert.deepEqual(granted, [{ version: setup.document.version, page: 2 }])

        const otherPage = refusal(
          await tools.ask(
            token,
            figureQuestion(lot, [
              pageTwoFigure(),
              pageTwoFigure({ page: 1, region: { x: 0, y: 0, width: 200, height: 150 } }),
            ]),
          ),
        )
        assert.equal(otherPage.error, 'source_not_delivered')
        assert.equal(otherPage.issues?.[0]?.path, '/figures/1/source/page')
        accepted(await tools.propose(token, citing(lot, setup.document.source)))
        accepted(await tools.ask(token, figureQuestion(lot, [pageTwoFigure()])))
      },
      { vm: true },
    )
  })
}

test('a valid ask stores its question, figures and view renders in one transaction, including a version announced after the manifest', async () => {
  await withFigureSession(async (setup) => {
    const { fixture, tools, token, lot, photoFigure } = setup
    await fetched(setup, setup.photo)
    await fixture.db.pool.query(
      "INSERT INTO agent_session_inbox(id,session_lineage_id,seq,kind,payload,idempotency_key) VALUES($1,$2,1,'evidence',$3,$4)",
      [
        randomUUID(),
        setup.session.job,
        { evidence_id: setup.noticed.evidence, version_id: setup.noticed.version },
        setup.noticed.version,
      ],
    )
    const noticedFigure = figure({
      evidence_id: setup.noticed.evidence,
      version_id: setup.noticed.version,
      page: 1,
      region: { x: 10, y: 20, width: 120, height: 90 },
      quarterTurns: 3,
    })
    // Announced but not yet fetched, the version gives no picture.
    assert.equal(
      refusal(await tools.ask(token, figureQuestion(lot, [photoFigure(), noticedFigure])))
        .issues?.[0]?.path,
      '/figures/1/source/version_id',
    )
    await fetched(setup, setup.noticed)
    const before = await processingChanged(fixture, setup.batchId)

    const asked = accepted(
      await tools.ask(token, figureQuestion(lot, [photoFigure(), noticedFigure])),
    )

    const question = await fixture.db.pool.query<{ xmin: string }>(
      'SELECT xmin::text FROM processing_question WHERE id=$1',
      [asked.id],
    )
    const figures = await fixture.db.pool.query<{
      figure_index: number
      version_id: string
      page: number
      recipe_digest: Buffer
      xmin: string
    }>(
      `SELECT figure_index, version_id, page, recipe_digest, xmin::text
       FROM processing_question_figure WHERE question_id=$1 ORDER BY figure_index`,
      [asked.id],
    )
    const views = await renderRows(setup, 'view')
    assert.deepEqual(
      figures.rows.map((row) => [row.figure_index, row.version_id, row.page]),
      [
        [1, setup.photo.version, 1],
        [2, setup.noticed.version, 1],
      ],
    )
    assert.deepEqual(
      views.map((row) => row.state),
      ['queued', 'queued'],
    )
    assert.deepEqual(
      new Set(views.map((row) => row.recipe_digest.toString('hex'))),
      new Set(figures.rows.map((row) => row.recipe_digest.toString('hex'))),
    )
    const transactions = new Set([
      question.rows[0]!.xmin,
      ...figures.rows.map((row) => row.xmin),
      ...views.map((row) => row.xmin),
    ])
    assert.equal(transactions.size, 1, 'question, figures and renders commit together')
    assert.equal(await processingChanged(fixture, setup.batchId), before + 1)

    // The stored recipe names the page and its preview size.
    const recipe = await fixture.db.pool.query<{ recipe: string }>(
      `SELECT convert_from(r.recipe_bytes,'UTF8') AS recipe FROM processing_figure_render r
       JOIN processing_question_figure f ON f.recipe_digest=r.recipe_digest
       WHERE f.question_id=$1 AND f.figure_index=2`,
      [asked.id],
    )
    assert.deepEqual(JSON.parse(recipe.rows[0]!.recipe), {
      version: 'bench-intake-view/1',
      source_version_id: setup.noticed.version,
      source_digest: setup.noticed.source.sha256,
      page: 1,
      page_width: 240,
      page_height: 180,
      view: {
        region: { x: 10, y: 20, width: 120, height: 90 },
        quarter_turns: 3,
        straighten_millidegrees: 0,
      },
    })
    assert.deepEqual(await storedFigures(fixture, setup.session.job, setup.batchId), {
      questions: 1,
      figures: 2,
      views: 2,
      previews: 0,
      outbox: 1,
    })
  })
})

test('a preview returns its marked renders within the image budget, stores no question, and edited marks render again', async () => {
  await withFigureSession(async (setup) => {
    const { fixture, tools, token, lot, photoFigure, pageTwoFigure, context } = setup
    await fetched(setup, setup.photo)
    await fetched(setup, setup.document, 2)
    const renderer = fakeRenderer()
    const stop = consumer(setup, renderer)
    try {
      const run = digest(Buffer.from(token))
      const budgetBefore = context.imageBudget.get(run) ?? 0
      const figures = [photoFigure(), pageTwoFigure()]

      const output = await tools.ask(token, figureQuestion(lot, figures, true))

      const first = accepted(output)
      assert.equal(first.id, undefined)
      assert.equal(output.images?.length, 2)
      const bytes = output.images!.map((image) => Buffer.from(image.base64, 'base64'))
      assert.deepEqual(
        first.preview?.map((entry) => [entry.figure, entry.sha256]),
        bytes.map((image, index) => [index + 1, digest(image)]),
      )
      for (const [index, image] of bytes.entries()) {
        const decoded = await sharp(image).metadata()
        assert.deepEqual(
          [decoded.width, decoded.height],
          [first.preview![index]!.width, first.preview![index]!.height],
        )
      }
      const total = bytes.reduce((sum, image) => sum + image.length, 0)
      assert.ok(total <= FIGURE_PREVIEW_MAX_BYTES)
      assert.equal((context.imageBudget.get(run) ?? 0) - budgetBefore, total)
      assert.ok(renderer.calls.every((call) => call.marks !== null && call.marks.length === 1))
      assert.deepEqual(await storedFigures(fixture, setup.session.job, setup.batchId), {
        questions: 0,
        figures: 0,
        views: 0,
        previews: 2,
        outbox: 0,
      })

      // The same marks reuse their renders; edited marks render again.
      const again = await tools.ask(token, figureQuestion(lot, figures, true))
      assert.deepEqual(
        accepted(again).preview?.map((entry) => entry.sha256),
        first.preview?.map((entry) => entry.sha256),
      )
      assert.equal(renderer.calls.length, 2)
      const edited = [photoFigure(), pageTwoFigure({ label: 'Pin 1 notch' })]
      const redone = accepted(await tools.ask(token, figureQuestion(lot, edited, true)))
      assert.equal(renderer.calls.length, 3)
      assert.deepEqual(renderer.calls.at(-1)!.marks?.[0], {
        kind: 'box',
        geometry: { x: 2000, y: 2500, width: 5000, height: 4000 },
        label: 'Pin 1 notch',
      })
      assert.equal(redone.preview![0]!.sha256, first.preview![0]!.sha256)
      assert.notEqual(redone.preview![1]!.sha256, first.preview![1]!.sha256)
      assert.equal((await renderRows(setup, 'preview')).length, 3)

      // Asking for real stores the question and queues the operator's unmarked views.
      accepted(await tools.ask(token, figureQuestion(lot, edited)))
      const stored = await storedFigures(fixture, setup.session.job, setup.batchId)
      assert.deepEqual([stored.questions, stored.figures, stored.views], [1, 2, 2])
    } finally {
      await stop()
    }
  })
})

test('a preview not rendered in time is retryable with no images, and too many waiting previews are refused as busy', async () => {
  await withFigureSession(async (setup) => {
    const { fixture, token, lot, photoFigure, context } = setup
    await fetched(setup, setup.photo)
    // No render consumer runs, so every preview stays queued.
    const tools = sessionTools({ ...context, figurePreviewWaitMs: 60 })
    const preview = (labels: string[]) =>
      tools.ask(
        token,
        figureQuestion(
          lot,
          labels.map((label) => photoFigure({ label })),
          true,
        ),
      )

    const late = await preview(['Pending 0'])
    assert.equal(refusal(late).error, 'preview_not_ready')
    assert.equal(late.images, undefined)
    assert.equal(context.imageBudget.size, 1, 'only the fetch spent image budget')

    let label = 1
    const labels = (count: number) => Array.from({ length: count }, () => `Pending ${label++}`)
    for (const count of [5, 5, 5, 4]) {
      assert.equal(refusal(await preview(labels(count))).error, 'preview_not_ready')
    }
    assert.equal((await renderRows(setup, 'preview')).length, MAX_PENDING_PREVIEWS)

    const busy = refusal(await preview(labels(1)))
    assert.equal(busy.error, 'preview_busy')
    assert.equal((await renderRows(setup, 'preview')).length, MAX_PENDING_PREVIEWS)
    assert.deepEqual(await storedFigures(fixture, setup.session.job, setup.batchId), {
      questions: 0,
      figures: 0,
      views: 0,
      previews: MAX_PENDING_PREVIEWS,
      outbox: 0,
    })
  })
})

test('a preview that settles after its wait is still not ready, and one swept while waiting says its photo went', async () => {
  await withFigureSession(async (setup) => {
    const { fixture, token, lot, photoFigure, context } = setup
    await fetched(setup, setup.photo)

    // Settles about 60 ms after the 60 ms wait, before the next 200 ms poll would have read it.
    const renderer = fakeRenderer()
    const slow: typeof renderer = Object.assign(
      async (input: Parameters<typeof renderer>[0]) => {
        await new Promise((resolve) => setTimeout(resolve, 120))
        return renderer(input)
      },
      { calls: renderer.calls },
    )
    const stop = consumer(setup, slow)
    try {
      const waiting = sessionTools({ ...context, figurePreviewWaitMs: 60 })
      const late = await waiting.ask(token, figureQuestion(lot, [photoFigure()], true))
      assert.equal(refusal(late).error, 'preview_not_ready')
      assert.equal(late.images, undefined)
    } finally {
      await stop()
    }

    // No consumer: the preview stays queued until the sweep deletes it mid-wait.
    const patient = sessionTools({ ...context, figurePreviewWaitMs: 10_000 })
    const sweptWhileWaiting = async (label: string, before?: () => Promise<void>) => {
      const asking = patient.ask(token, figureQuestion(lot, [photoFigure({ label })], true))
      let swept = 0
      for (let tries = 0; swept === 0 && tries < 200; tries += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20))
        const queued = await fixture.db.pool.query(
          `SELECT 1 FROM processing_figure_render WHERE purpose='preview' AND state='queued'`,
        )
        if (!queued.rowCount) {
          continue
        }
        await before?.()
        const deleted = await fixture.db.pool.query(
          `DELETE FROM processing_figure_render WHERE purpose='preview' AND state='queued'`,
        )
        swept = deleted.rowCount ?? 0
      }
      assert.ok(swept > 0)
      return asking
    }

    // Expired while its photo is still there: asked again, it renders afresh.
    const expired = await sweptWhileWaiting('Expired')
    assert.equal(refusal(expired).error, 'preview_not_ready')
    assert.equal(expired.images, undefined)

    // Swept because its photo was removed: the agent is told the photo went.
    const gone = await sweptWhileWaiting('Removed', async () => {
      await mediaEditor(fixture.api.pool, fixture.config, setup.batchId).applied({
        kind: 'remove',
        evidence_ids: [setup.photo.evidence],
      })
    })
    assert.equal(refusal(gone).error, 'media_evidence_removed')
    assert.equal(gone.images, undefined)
  })
})

test('a preview whose checkout or state read is slower than its wait answers in time, closes the read at the deadline and sends no SQL after it', async () => {
  await withFigureSession(async (setup) => {
    const { fixture, token, lot, photoFigure, context } = setup
    await fetched(setup, setup.photo)
    const stop = consumer(setup, fakeRenderer())
    const waitMs = 100
    try {
      // `blocked`: part of the wait goes before the read, then the read blocks in the database.
      // `gone`: the late read would find its render deleted and ask about removals.
      for (const slow of ['checkout', 'blocked', 'gone'] as const) {
        let released = 0
        let discarded = 0
        let checkedOut = 0
        let stateCheckoutAt = 0
        let discardedAt = 0
        let stateReadsDone = false
        const lateStatements: string[] = []
        // Checkouts after the ask's own transaction are the preview's state reads.
        const slowPool = new Proxy(context.pool, {
          get(target, property) {
            if (property === 'connect') {
              return async () => {
                const client = await target.connect()
                checkedOut += 1
                const readsState = checkedOut > 1
                if (readsState && slow === 'checkout') {
                  await new Promise((resolve) => setTimeout(resolve, 1_500))
                  stateReadsDone = true
                }
                if (readsState && !stateCheckoutAt) {
                  stateCheckoutAt = Date.now()
                }
                const release = client.release.bind(client)
                client.release = (error?: Error | boolean) => {
                  released += 1
                  if (error) {
                    discarded += 1
                    discardedAt = Date.now()
                  }
                  release(error)
                }
                if (readsState) {
                  const query = client.query.bind(client) as (
                    ...args: unknown[]
                  ) => Promise<unknown>
                  ;(client as { query: unknown }).query = async (...args: unknown[]) => {
                    const statement = String(args[0])
                    if (stateReadsDone) {
                      lateStatements.push(statement)
                    }
                    const readsRenders = statement.includes(
                      'processing_figure_render WHERE id = ANY',
                    )
                    if (!readsRenders || slow === 'checkout') {
                      return query(...args)
                    }
                    try {
                      if (slow === 'blocked') {
                        await new Promise((resolve) => setTimeout(resolve, waitMs * 0.6))
                        await query('SELECT pg_sleep(2)')
                      } else {
                        await new Promise((resolve) => setTimeout(resolve, 1_500))
                        await fixture.db.pool.query(
                          `DELETE FROM processing_figure_render WHERE id = ANY($1::uuid[])`,
                          [(args[1] as unknown[])[0]],
                        )
                      }
                      return await query(...args)
                    } finally {
                      stateReadsDone = true
                    }
                  }
                }
                return client
              }
            }
            const value: unknown = Reflect.get(target, property, target)
            return typeof value === 'function' ? value.bind(target) : value
          },
        })
        const tools = sessionTools({ ...context, pool: slowPool, figurePreviewWaitMs: waitMs })
        const started = Date.now()
        const late = await tools.ask(
          token,
          figureQuestion(lot, [photoFigure({ label: `Slow ${slow}` })], true),
        )
        const elapsed = Date.now() - started
        assert.equal(refusal(late).error, 'preview_not_ready', slow)
        assert.equal(late.images, undefined)
        assert.ok(elapsed < 1_000, `${slow}: answered after ${elapsed} ms`)
        // The slow step ends on its own; nothing more is sent and every connection is returned.
        await new Promise((resolve) => setTimeout(resolve, 2_500))
        assert.ok(stateReadsDone, `${slow}: the slow step finished`)
        assert.deepEqual(lateStatements, [], `${slow}: no statement after the wait`)
        assert.equal(released, checkedOut, `${slow}: every connection returned`)
        // A read cut off at the deadline loses its connection then, however long it would run.
        assert.equal(discarded, slow === 'checkout' ? 0 : 1, `${slow}: discarded connections`)
        if (slow !== 'checkout') {
          const heldFor = discardedAt - stateCheckoutAt
          assert.ok(heldFor <= waitMs + 100, `${slow}: connection held ${heldFor} ms`)
        }
      }
    } finally {
      await stop()
    }
  })
})

test('a connection lost during a preview poll fails the call, not the process', async () => {
  await withFigureSession(async (setup) => {
    const { fixture, token, lot, photoFigure, context } = setup
    await fetched(setup, setup.photo)
    let checkedOut = 0
    const losing = new Proxy(context.pool, {
      get(target, property) {
        if (property === 'connect') {
          return async () => {
            const client = await target.connect()
            checkedOut += 1
            if (checkedOut > 1) {
              const query = client.query.bind(client) as (...args: unknown[]) => unknown
              ;(client as { query: unknown }).query = async (...args: unknown[]) => {
                if (String(args[0]).includes('processing_figure_render WHERE id = ANY')) {
                  const pid = (client as unknown as { processID: number }).processID
                  await fixture.db.pool.query('SELECT pg_terminate_backend($1)', [pid])
                }
                return query(...args)
              }
            }
            return client
          }
        }
        const value: unknown = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const tools = sessionTools({ ...context, pool: losing, figurePreviewWaitMs: 5_000 })
    await assert.rejects(tools.ask(token, figureQuestion(lot, [photoFigure()], true)))
    // Still running: the next call is answered.
    assert.equal(
      refusal(await sessionTools(context).ask(token, figureQuestion(lot, [], true))).error,
      'validation_failed',
    )
  })
})

test('a preview asked again after a day is kept and answered, not swept from under the ask', async () => {
  await withFigureSession(async (setup) => {
    const { fixture, tools, token, lot, photoFigure, media, store, binding } = setup
    await fetched(setup, setup.photo)
    const stop = consumer(setup, fakeRenderer())
    try {
      accepted(await tools.ask(token, figureQuestion(lot, [photoFigure()], true)))
      // A day and more later the same preview is asked for again.
      await fixture.db.pool.query(
        `UPDATE processing_figure_render SET requested_at=now() - interval '2 days'
         WHERE purpose='preview'`,
      )
      const again = await tools.ask(token, figureQuestion(lot, [photoFigure()], true))
      assert.equal(again.images?.length, 1)
    } finally {
      await stop()
    }
    assert.equal((await sweepFigureRenders(media.pool, store, binding)).deleted, 0)
    assert.equal((await renderRows(setup, 'preview')).length, 1)
  })
})

test('an identical ask racing the sweep of its expired preview gets a fresh render', async () => {
  await withFigureSession(async (setup) => {
    const { fixture, tools, token, lot, photoFigure, media, store, binding } = setup
    await fetched(setup, setup.photo)
    const renderer = fakeRenderer()
    const first = consumer(setup, renderer)
    try {
      accepted(await tools.ask(token, figureQuestion(lot, [photoFigure()], true)))
    } finally {
      await first()
    }
    const [expired] = await fixture.db.pool
      .query<{ id: string; digest: string }>(
        `UPDATE processing_figure_render SET requested_at=now() - interval '2 days'
       WHERE purpose='preview' RETURNING id, encode(preview_digest,'hex') AS digest`,
      )
      .then((result) => result.rows)

    // The sweep deletes the expired preview and stops at its blob lock, holding the row.
    const holder = await fixture.db.pool.connect()
    let asking: ReturnType<typeof tools.ask> | undefined
    let sweeping: ReturnType<typeof sweepFigureRenders> | undefined
    const waitingOn = async (pattern: string) => {
      for (let tries = 0; tries < 200; tries += 1) {
        const rows = await fixture.db.pool.query(
          `SELECT 1 FROM pg_stat_activity WHERE wait_event_type IN ('Lock','advisory')
             AND query LIKE $1`,
          [pattern],
        )
        if (rows.rowCount) {
          return true
        }
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      return false
    }
    try {
      await holder.query('BEGIN')
      await lockBlob(holder, expired!.digest)
      sweeping = sweepFigureRenders(media.pool, store, binding)
      assert.ok(await waitingOn('%pg_advisory_xact_lock%'), 'the sweep waits at the blob lock')
      // The identical ask meets the row the sweep is deleting and waits for its outcome.
      asking = tools.ask(token, figureQuestion(lot, [photoFigure()], true))
      assert.ok(await waitingOn('INSERT INTO public.processing_figure_render%'), 'the ask waits')
    } finally {
      await holder.query('COMMIT').catch(() => undefined)
      holder.release()
    }
    const second = consumer(setup, renderer)
    try {
      assert.equal((await sweeping!).deleted, 1)
      const answered = await asking!
      assert.equal(answered.images?.length, 1)
    } finally {
      await second()
    }
    const rows = await renderRows(setup, 'preview')
    assert.equal(rows.length, 1)
    assert.notEqual(rows[0]!.id, expired!.id)
  })
})

test('a preview on the relay without the larger frame is refused before anything renders', async () => {
  await withFigureSession(
    async (setup) => {
      const { tools, token, lot, photoFigure } = setup
      recordMediaDelivery(setup.context.deliveredMedia, setup.session.job, setup.photo.version, {
        attemptId: setup.session.attempt,
        page: 1,
      })

      const refused = refusal(await tools.ask(token, figureQuestion(lot, [photoFigure()], true)))
      assert.equal(refused.error, 'validation_failed')
      assert.equal(refused.issues?.[0]?.path, '/preview')
      assert.equal((await renderRows(setup, 'preview')).length, 0)
      accepted(await tools.ask(token, figureQuestion(lot, [photoFigure()])))
    },
    { vm: 'v1' },
  )
})

/** Deterministic noise, which JPEG can't compress much. */
function noise(width: number, height: number, seed: number) {
  const pixels = Buffer.alloc(width * height * 3)
  let state = seed >>> 0 || 1
  for (let at = 0; at < pixels.length; at += 1) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    pixels[at] = state & 0xff
  }
  return pixels
}

/**
 * A noise PNG whose agent delivery (JPEG at quality 90, as the tool server sends a preview) falls
 * within `[min, max]` bytes, found by searching its width.
 */
async function noiseOfDeliveredSize(min: number, max: number, seed: number) {
  const height = 1200
  let low = 100
  let high = 2500
  for (let step = 0; step < 24 && low <= high; step += 1) {
    const width = Math.floor((low + high) / 2)
    const pixels = noise(width, height, seed)
    const raw = { raw: { width, height, channels: 3 as const } }
    const size = (
      await sharp(pixels, raw)
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 90, mozjpeg: true })
        .toBuffer()
    ).length
    if (size < min) {
      low = width + 1
    } else if (size > max) {
      high = width - 1
    } else {
      return sharp(pixels, raw).png().toBuffer()
    }
  }
  throw new Error('no_noise_width_in_range')
}

/** One JSON-RPC tool call to the session tool server, as the coordinator relays it. */
async function rawToolCall(url: string, token: string, id: number, name: string, args: unknown) {
  const mcp = JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name, arguments: args },
  })
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: mcp,
  })
  return { mcp, status: response.status, body: await response.text() }
}

test('five near-limit preview pictures cross the VM relay in file and inline delivery, and more is refused', async () => {
  await withFigureSession(async (setup) => {
    const { tools, token, lot, photoFigure } = setup
    const options: { preview?: Buffer } = {
      preview: await noiseOfDeliveredSize(1_100_000, 1_240_000, 11),
    }
    const stop = consumer(setup, fakeRenderer(options))
    const server = await startSessionToolServer({
      pool: setup.fixture.runner.pool,
      config: setup.fixture.config,
      store: setup.store,
      cropCacheDir: join(setup.root, 'server-crops'),
      statusIntervalMs: 0,
    })
    try {
      const fetch = await rawToolCall(server.url, token, 1, 'fetch_evidence', {
        evidence_id: setup.photo.evidence,
        version_id: setup.photo.version,
      })
      assert.equal(fetch.status, 200)
      const five = Array.from({ length: 5 }, (_, n) => photoFigure({ label: `Lead ${n + 1}` }))
      const call = await rawToolCall(server.url, token, 2, 'ask', figureQuestion(lot, five, true))
      assert.equal(call.status, 200)
      const reply = JSON.parse(call.body)
      assert.equal(reply.result.isError, false, call.body.slice(0, 400))
      const images = reply.result.content.filter((item: { type: string }) => item.type === 'image')
      assert.equal(images.length, 5)
      const total = images.reduce(
        (sum: number, item: { data: string }) => sum + Buffer.from(item.data, 'base64').length,
        0,
      )
      assert.ok(total > 5_400_000 && total <= FIGURE_PREVIEW_MAX_BYTES, String(total))

      // The relay gives an ask preview the evidence frame but never a citation receipt.
      assert.deepEqual(evidenceRequest(call.mcp), { id: 2, kind: 'preview' })
      assert.throws(
        () => new TurnEvidenceReleases().prepare(2, call.body, 'current'),
        /invalid_evidence_file/,
      )
      const wire = new PassThrough()
      const frames = new Frames(wire)
      await assert.rejects(frames.send({ status: 200, body: call.body }), /runner_frame_limit/)
      const [framed] = await Promise.all([
        frames.read(evidenceReplyLimit),
        frames.send({ status: 200, body: call.body }, evidenceReplyLimit),
      ])
      assert.equal(framed.body, call.body)

      for (const delivery of ['file', 'inline'] as const) {
        const requests: Record<string, unknown>[] = []
        const proxy = await startMcpProxy(
          async (message) => {
            requests.push(message)
            return { status: 200, body: framed.body }
          },
          true,
          delivery,
        )
        try {
          const response = await globalThis.fetch(proxy.toolUrl, {
            method: 'POST',
            headers: { authorization: 'Bearer ' + proxy.capability },
            body: call.mcp,
          })
          assert.equal(response.status, 200, delivery)
          const staged = (await response.json()).result
          const files = staged.structuredContent.local_files as {
            figure: number
            path: string
            sha256: string
          }[]
          assert.deepEqual(
            files.map((file) => file.figure),
            [1, 2, 3, 4, 5],
          )
          for (const [index, file] of files.entries()) {
            assert.equal(digest(await readFile(file.path)), file.sha256)
            assert.equal(file.sha256, reply.result.structuredContent.preview[index].sha256)
            assert.equal((await stat(file.path)).mode & 0o777, 0o600)
          }
          assert.equal(staged.structuredContent.source, undefined)
          assert.equal(
            staged.content.filter((item: { type: string }) => item.type === 'image').length,
            delivery === 'inline' ? 5 : 0,
          )
          await proxy.flush()
          assert.equal(requests.length, 1, 'no release is acknowledged for a preview')
        } finally {
          await proxy.close()
        }
      }

      // Five pictures over the aggregate limit are refused as correctable, sending nothing.
      options.preview = await noiseOfDeliveredSize(1_262_000, 1_305_000, 23)
      await fetched(setup, setup.photo)
      const run = digest(Buffer.from(token))
      const spent = setup.context.imageBudget.get(run) ?? 0
      const over = await tools.ask(
        token,
        figureQuestion(
          lot,
          Array.from({ length: 5 }, (_, n) => photoFigure({ label: `Over ${n + 1}` })),
          true,
        ),
      )
      assert.equal(refusal(over).error, 'validation_failed')
      assert.match(refusal(over).message, /too large to send together/)
      assert.equal(over.images, undefined)
      assert.equal(setup.context.imageBudget.get(run) ?? 0, spent)
    } finally {
      await server.close()
      await stop()
    }
  })
})

test('an upload decode waiting on the dispatcher runs right after the render holding it', async () => {
  await withFigureSession(async (setup) => {
    const { tools, token, lot, photoFigure } = setup
    await fetched(setup, setup.photo)
    accepted(
      await tools.ask(
        token,
        figureQuestion(lot, [
          photoFigure(),
          photoFigure({ region: { x: 0, y: 0, width: 100, height: 80 } }),
          photoFigure({ region: { x: 2, y: 2, width: 100, height: 80 } }),
        ]),
      ),
    )
    // A dispatcher with one slot, as `dispatcher-main.ts` has, holding each decode 300 ms.
    const socketRoot = await mkdtemp(join(tmpdir(), 'dispatch-'))
    const socket = join(socketRoot, 'worker.sock')
    let busy = false
    const ran: string[] = []
    const dispatcher = createServer((req, res) => {
      if (busy) {
        req.resume()
        res.writeHead(503, { connection: 'close' }).end()
        return
      }
      busy = true
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        setTimeout(() => {
          ran.push(Buffer.concat(chunks).toString())
          busy = false
          res.writeHead(200).end('decoded')
        }, 300)
      })
    })
    await new Promise<void>((resolve) => dispatcher.listen(socket, resolve))
    // The consumer's renders go through the dispatcher without waiting, as the deployed one does.
    const fake = fakeRenderer()
    const throughDispatcher: RenderView = async (input) => {
      await requestDecode(socket, 'decoder', Buffer.from('render'), 0)
      return fake(input)
    }
    const stop = new AbortController()
    const running = runFigureRenderConsumer({
      pool: setup.media.pool,
      store: setup.store,
      binding: setup.binding,
      render: throughDispatcher,
      signal: stop.signal,
      pollMs: 50,
    })
    // Observed from the start, so a consumer failure is reported here rather than unhandled.
    let consumerSettled = false
    const consumerOutcome = running.then(
      () => undefined,
      (error: unknown) => error,
    )
    void consumerOutcome.then(() => {
      consumerSettled = true
    })
    const startupDeadline = Date.now() + 10_000
    let watching: ReturnType<typeof setInterval> | undefined
    const firstStarted = new Promise<void>((resolve, reject) => {
      watching = setInterval(() => {
        if (busy) {
          resolve()
        } else if (consumerSettled) {
          reject(new Error('the render consumer stopped before its first render'))
        } else if (Date.now() > startupDeadline) {
          reject(new Error('no render reached the dispatcher within 10 s'))
        }
      }, 5)
    })
    let consumerError: unknown
    try {
      await firstStarted
      // An upload's decode arrives while the first render holds the slot.
      const upload = await requestDecode(socket, 'decoder', Buffer.from('upload'))
      assert.equal(upload.toString(), 'decoded')
      for (let tries = 0; ran.length < 4 && tries < 200; tries += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    } finally {
      clearInterval(watching)
      stop.abort()
      consumerError = await consumerOutcome
      await new Promise((resolve) => dispatcher.close(resolve))
      await rm(socketRoot, { recursive: true, force: true })
    }
    assert.equal(consumerError, undefined)
    // The consumer pauses after each render, so the waiting upload takes the next turn.
    assert.deepEqual(ran, ['render', 'upload', 'render', 'render'])
  })
})

test('a render consumer whose subscription is refused or loses its connection fails and discards it', async () => {
  for (const failure of ['refused', 'lost'] as const) {
    await withFigureSession(async (setup) => {
      const releases: (Error | boolean | undefined)[] = []
      let releaseReal: ((error?: Error | boolean) => void) | undefined
      const failing = new Proxy(setup.media.pool, {
        get(target, property) {
          if (property === 'connect') {
            return async () => {
              const client = await target.connect()
              const release = client.release.bind(client)
              releaseReal = release
              client.release = (error?: Error | boolean) => {
                releases.push(error)
                release(error)
              }
              ;(client as { query: unknown }).query = async () => {
                if (failure === 'refused') {
                  throw new Error('listen_refused')
                }
                // As pg reports a lost socket: an `error` event on the client, then the query fails.
                setImmediate(() => client.emit('error', new Error('connection_lost')))
                await new Promise((resolve) => setTimeout(resolve, 20))
                throw new Error('Connection terminated unexpectedly')
              }
              return client
            }
          }
          const value: unknown = Reflect.get(target, property, target)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
      try {
        await assert.rejects(
          runFigureRenderConsumer({
            pool: failing,
            store: setup.store,
            binding: setup.binding,
            render: fakeRenderer(),
            signal: new AbortController().signal,
          }),
          failure === 'refused' ? /listen_refused/ : /connection_lost/,
        )
        // Still running here: a lost connection reached the consumer, not the process.
        assert.deepEqual(releases, [true], failure)
      } finally {
        // A connection the consumer kept would hold the fixture's teardown.
        if (!releases.length) {
          releaseReal?.(true)
        }
      }
    })
  }
})

test('render claims honour leases, recover an expired one, fail after three attempts and publish processing_changed', async () => {
  await withFigureSession(async (setup) => {
    const { fixture, tools, token, lot, photoFigure, media, store, binding } = setup
    await fetched(setup, setup.photo)
    const asked = accepted(
      await tools.ask(
        token,
        figureQuestion(lot, [
          photoFigure(),
          photoFigure({ region: { x: 0, y: 0, width: 100, height: 80 } }),
          photoFigure({ region: { x: 100, y: 100, width: 64, height: 48 } }),
        ]),
      ),
    )
    const [stale, flaky, exhausted] = await Promise.all(
      [1, 2, 3].map((index) => figureRender(setup, asked.id!, index)),
    )
    const t0 = new Date(Date.now() + 60_000)
    const at = (ms: number) => () => new Date(t0.getTime() + ms)
    // A consumer died holding the first render's lease; another holds the second's for an hour;
    // the third's last attempt died with its consumer.
    await fixture.db.pool.query(
      `UPDATE processing_figure_render SET lease_owner=$2, lease_expires_at=$3, attempts=1 WHERE id=$1`,
      [stale!.id, randomUUID(), new Date(t0.getTime() + RENDER_LEASE_MS)],
    )
    await fixture.db.pool.query(
      `UPDATE processing_figure_render SET lease_owner=$2, lease_expires_at=$3 WHERE id=$1`,
      [flaky!.id, randomUUID(), new Date(t0.getTime() + 3_600_000)],
    )
    await fixture.db.pool.query(
      `UPDATE processing_figure_render SET lease_owner=$2, lease_expires_at=$3, attempts=$4 WHERE id=$1`,
      [exhausted!.id, randomUUID(), new Date(t0.getTime() + 3_600_000), MAX_RENDER_ATTEMPTS],
    )
    const ok = fakeRenderer()
    const step = (clock: () => Date, render: RenderView = ok) =>
      renderFigureStep(media.pool, store, binding, render, clock)

    assert.equal(await step(at(0)), 'idle', 'every lease is held')
    let events = await processingChanged(fixture, setup.batchId)
    assert.equal(await step(at(RENDER_LEASE_MS)), 'rendered')
    const recovered = await figureRender(setup, asked.id!, 1)
    assert.deepEqual([recovered!.state, recovered!.attempts], ['ready', 2])
    assert.ok(recovered!.view && recovered!.thumb)
    assert.equal(await processingChanged(fixture, setup.batchId), events + 1)
    assert.equal(await step(at(RENDER_LEASE_MS)), 'idle')

    // A busy dispatcher ran nothing, so the second render is claimed again without spending
    // its attempts, however often the slot is taken.
    await fixture.db.pool.query(
      'UPDATE processing_figure_render SET lease_owner=NULL, lease_expires_at=NULL WHERE id=$1',
      [flaky!.id],
    )
    const busy: RenderView = async () => {
      throw new DecoderDispatcherBusyError()
    }
    for (const ms of [0, 6_000, 12_000, 18_000]) {
      assert.equal(await step(at(RENDER_LEASE_MS + ms), busy), 'retrying')
    }
    const waited = await figureRender(setup, asked.id!, 2)
    assert.deepEqual([waited!.state, waited!.attempts], ['queued', 0])

    // The second render's renderer keeps failing: each failure frees the lease after a delay.
    await fixture.db.pool.query(
      'UPDATE processing_figure_render SET lease_owner=NULL, lease_expires_at=NULL WHERE id=$1',
      [flaky!.id],
    )
    const failing: RenderView = async () => {
      throw new Error('decoder_dispatch_refused')
    }
    events = await processingChanged(fixture, setup.batchId)
    const outcomes = []
    for (const ms of [0, 1_000, 6_000, 12_000]) {
      outcomes.push(await step(at(RENDER_LEASE_MS + ms), failing))
    }
    assert.deepEqual(outcomes, ['retrying', 'idle', 'retrying', 'failed'])
    const failed = await figureRender(setup, asked.id!, 2)
    assert.deepEqual([failed!.state, failed!.attempts], ['failed', MAX_RENDER_ATTEMPTS])
    assert.equal(await processingChanged(fixture, setup.batchId), events + 1)

    // A render whose last attempt's lease expired settles as failed when claimed.
    events = await processingChanged(fixture, setup.batchId)
    assert.equal(await step(at(3_600_000)), 'failed')
    const settled = await figureRender(setup, asked.id!, 3)
    assert.deepEqual([settled!.state, settled!.attempts], ['failed', MAX_RENDER_ATTEMPTS])
    assert.equal(await processingChanged(fixture, setup.batchId), events + 1)
    assert.equal(ok.calls.length, 1)
  })
})

test('the sweep deletes old previews, unreferenced views and a removed version’s renders, then collects their blobs', async () => {
  await withFigureSession(async (setup) => {
    const { fixture, tools, token, lot, photoFigure, pageTwoFigure, media, store, binding } = setup
    await fetched(setup, setup.photo)
    await fetched(setup, setup.document, 2)
    const asked = accepted(
      await tools.ask(token, figureQuestion(lot, [photoFigure(), pageTwoFigure()])),
    )
    // A view no question references, as left by a question that never committed its figures.
    const orphanRecipe = {
      version: 'bench-intake-view/1' as const,
      source_version_id: setup.photo.version,
      source_digest: setup.photo.source.sha256,
      page: 1,
      page_width: 320,
      page_height: 240,
      view: {
        region: { x: 0, y: 0, width: 32, height: 24 },
        quarter_turns: 2,
        straighten_millidegrees: 0,
      },
    }
    await transaction(fixture.runner.pool, (client) =>
      enqueueFigureRenders(client, setup.batchId, [{ recipe: orphanRecipe }]),
    )
    const stop = consumer(setup, fakeRenderer())
    try {
      const previewed = await tools.ask(token, figureQuestion(lot, [photoFigure()], true))
      accepted(previewed)
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const states = await fixture.db.pool.query<{ queued: number }>(
          "SELECT count(*)::int AS queued FROM processing_figure_render WHERE state='queued'",
        )
        if (states.rows[0]!.queued === 0) {
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    } finally {
      await stop()
    }
    const outputs = await fixture.db.pool.query<{
      id: string
      purpose: string
      version_id: string
      digests: string[]
    }>(
      `SELECT id, purpose, version_id,
         array_remove(ARRAY[encode(view_digest,'hex'),encode(thumb_digest,'hex'),encode(preview_digest,'hex')],NULL) AS digests
       FROM processing_figure_render WHERE state='ready'`,
    )
    assert.equal(outputs.rows.length, 4, 'two views, an orphan view and a preview are ready')
    const kept = (await figureRender(setup, asked.id!, 1))!
    const removedView = (await figureRender(setup, asked.id!, 2))!
    const released = outputs.rows.filter((row) => row.id !== kept.id)
    const blobPath = (sha: string) => join(setup.root, 'blobs', 'objects', sha.slice(0, 2), sha)

    await mediaEditor(fixture.api.pool, fixture.config, setup.batchId).applied({
      kind: 'remove',
      evidence_ids: [setup.document.evidence],
    })
    const first = await sweepFigureRenders(media.pool, store, binding)
    assert.deepEqual(first, { deleted: 1, collected: 0 })
    const releaseRows = async () =>
      (
        await fixture.db.pool.query<{ digest: string }>(
          "SELECT encode(digest,'hex') AS digest FROM processing_figure_blob_release ORDER BY 1",
        )
      ).rows.map((row) => row.digest)
    assert.deepEqual(
      await releaseRows(),
      [...outputs.rows.find((row) => row.id === removedView.id)!.digests].sort(),
    )

    // A day later the preview and the orphan view go too; the referenced view stays. Their
    // files are a day old by then, so the same sweep collects every released blob.
    const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    for (const sha of released.flatMap((row) => row.digests)) {
      await utimes(blobPath(sha), old, old)
    }
    const later = () => new Date(Date.now() + 25 * 60 * 60 * 1000)
    const second = await sweepFigureRenders(media.pool, store, binding, later)
    const releasedDigests = new Set(released.flatMap((row) => row.digests))
    assert.deepEqual(second, { deleted: 2, collected: releasedDigests.size })
    assert.deepEqual(await releaseRows(), [])
    for (const sha of releasedDigests) {
      await assert.rejects(stat(blobPath(sha)), { code: 'ENOENT' })
    }
    const remaining = await fixture.db.pool.query<{ id: string }>(
      'SELECT id FROM processing_figure_render',
    )
    assert.deepEqual(
      remaining.rows.map((row) => row.id),
      [kept.id],
    )
    assert.ok((await stat(blobPath(kept.view!))).isFile())
    assert.ok((await stat(blobPath(kept.thumb!))).isFile())
  })
})

function findById(value: unknown, id: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  if (!Array.isArray(value) && (value as { id?: unknown }).id === id) {
    return value as Record<string, unknown>
  }
  for (const child of Object.values(value)) {
    const found = findById(child, id)
    if (found) {
      return found
    }
  }
  return undefined
}

test('a blob released while a collection holds its lock stays recorded for the next collection', async () => {
  await withFigureSession(async (setup) => {
    const { fixture, tools, token, lot, pageTwoFigure, media, store, binding } = setup
    await fetched(setup, setup.document, 2)
    const asked = accepted(await tools.ask(token, figureQuestion(lot, [pageTwoFigure()])))
    const stop = consumer(setup, fakeRenderer())
    try {
      for (let tries = 0; tries < 100; tries += 1) {
        if ((await figureRender(setup, asked.id!, 1))?.view) {
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    } finally {
      await stop()
    }
    const view = (await figureRender(setup, asked.id!, 1))!.view!
    await mediaEditor(fixture.api.pool, fixture.config, setup.batchId).applied({
      kind: 'remove',
      evidence_ids: [setup.document.evidence],
    })

    // A collection has locked the blob and seen the render still referencing it.
    const collector = await media.pool.connect()
    let sweeping: Promise<unknown> | undefined
    try {
      await collector.query('BEGIN')
      await lockBlob(collector, view)
      let settled = false
      sweeping = sweepFigureRenders(media.pool, store, binding).finally(() => {
        settled = true
      })
      await new Promise((resolve) => setTimeout(resolve, 300))
      assert.equal(settled, false, 'the release waits for the collection’s lock')
      await collector.query('DELETE FROM public.processing_figure_blob_release WHERE digest=$1', [
        Buffer.from(view, 'hex'),
      ])
      await collector.query('COMMIT')
    } finally {
      collector.release()
    }
    await sweeping

    const recorded = () =>
      fixture.db.pool.query('SELECT 1 FROM processing_figure_blob_release WHERE digest=$1', [
        Buffer.from(view, 'hex'),
      ])
    assert.equal((await recorded()).rowCount, 1)

    // Due a day later, but its file was written just now: it waits, still recorded.
    const later = () => new Date(Date.now() + 25 * 60 * 60 * 1000)
    assert.equal((await sweepFigureRenders(media.pool, store, binding, later)).collected, 0)
    assert.equal((await recorded()).rowCount, 1)

    const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    const file = join(setup.root, 'blobs', 'objects', view.slice(0, 2), view)
    await utimes(file, old, old)
    assert.ok((await sweepFigureRenders(media.pool, store, binding, later)).collected >= 1)
    assert.equal((await recorded()).rowCount, 0)
    await assert.rejects(stat(file), { code: 'ENOENT' })
  })
})

test('collection acts only on the release it selected, and clears one whose file is gone', async () => {
  await withFigureSession(async (setup) => {
    const { fixture, media, store } = setup
    const day = 24 * 60 * 60 * 1000
    const old = new Date(Date.now() - 2 * day)
    const bytes = Buffer.from('a released render')
    const published = await transaction(fixture.db.pool, (client) => store.publish(client, bytes))
    const file = join(
      setup.root,
      'blobs',
      'objects',
      published.digest.slice(0, 2),
      published.digest,
    )
    await utimes(file, old, old)
    const release = async (digest: string, at: Date) => {
      const rows = await fixture.db.pool.query<{ released: string }>(
        `INSERT INTO processing_figure_blob_release(digest, released_at) VALUES($1,$2)
         RETURNING released_at::text AS released`,
        [Buffer.from(digest, 'hex'), at],
      )
      return { digest, released: rows.rows[0]!.released }
    }
    const recorded = async (digest: string) =>
      (
        await fixture.db.pool.query(
          'SELECT 1 FROM processing_figure_blob_release WHERE digest=$1',
          [Buffer.from(digest, 'hex')],
        )
      ).rowCount

    // Two collectors select the same release; the first collects it.
    const selected = await release(published.digest, old)
    assert.equal(await collectReleasedBlob(media.pool, store, selected), true)
    await assert.rejects(stat(file), { code: 'ENOENT' })

    // Republished and released again before the second acts on its stale selection.
    await transaction(fixture.db.pool, (client) => store.publish(client, bytes))
    await release(published.digest, new Date())
    assert.equal(await collectReleasedBlob(media.pool, store, selected), false)
    assert.ok((await stat(file)).isFile())
    assert.equal(await recorded(published.digest), 1)

    // A release whose file is already gone is cleared, so it can't hold the queue.
    const absent = createHash('sha256').update('never written').digest('hex')
    assert.equal(await collectReleasedBlob(media.pool, store, await release(absent, old)), false)
    assert.equal(await recorded(absent), 0)
  })
})

test('a render settling while the sweep deletes it and a ready render of the same bytes both finish', async () => {
  await withFigureSession(async (setup) => {
    const { fixture, tools, token, lot, photoFigure, media, store, binding } = setup
    await fetched(setup, setup.photo)
    const first = photoFigure()
    accepted(
      await tools.ask(
        token,
        figureQuestion(lot, [
          first,
          photoFigure({ region: { x: 0, y: 0, width: 100, height: 80 } }),
        ]),
      ),
    )
    // Every render gives the first figure's bytes, so the two renders share their blobs.
    const renderer = fakeRenderer()
    const outputs = new Set<string>()
    const same: RenderView = async (input) => {
      const rendered = await renderer({
        ...input,
        recipe: { ...input.recipe, view: { ...input.recipe.view, region: first.view.region } },
      })
      if (rendered.state === 'ready') {
        outputs.add(digest(rendered.view.bytes))
        outputs.add(digest(rendered.thumb.bytes))
      }
      return rendered
    }
    assert.equal(await renderFigureStep(media.pool, store, binding, same), 'rendered')

    // The second render's settlement stops at its first publish until the sweep is waiting.
    let reached!: () => void
    const atPublish = new Promise<void>((resolve) => {
      reached = resolve
    })
    let open!: () => void
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })
    const gated = Object.create(store) as BlobStore
    gated.publish = async (client, bytes) => {
      reached()
      await gate
      return store.publish(client, bytes)
    }
    // Each operation is observed as it starts, so a failure is drained here, never unhandled.
    const settlement = outcomeOf(renderFigureStep(media.pool, gated, binding, same))
    type SweepResult = Awaited<ReturnType<typeof sweepFigureRenders>>
    let sweep: Promise<PromiseSettledResult<SweepResult>> | undefined
    let settled: PromiseSettledResult<string>
    let swept: PromiseSettledResult<SweepResult> | undefined
    let waiting = false
    try {
      await Promise.race([
        atPublish,
        new Promise((_, reject) => setTimeout(() => reject(new Error('no_publish')), 10_000)),
      ])
      await mediaEditor(fixture.api.pool, fixture.config, setup.batchId).applied({
        kind: 'remove',
        evidence_ids: [setup.photo.evidence],
      })
      sweep = outcomeOf(sweepFigureRenders(media.pool, store, binding))
      for (let tries = 0; !waiting && tries < 200; tries += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20))
        const blocked = await fixture.db.pool.query(
          `SELECT 1 FROM pg_stat_activity
           WHERE wait_event_type='Lock' AND query LIKE 'DELETE FROM public.processing_figure_render%'`,
        )
        waiting = (blocked.rowCount ?? 0) > 0
      }
    } finally {
      // Released whatever happened, and both operations settle before the fixture is torn down.
      open()
      settled = await settlement
      swept = await sweep
    }
    assert.ok(waiting, 'the sweep waited on the settling render')
    assert.ok(swept, 'the sweep started')
    assert.ok(settled.status === 'fulfilled', String((settled as PromiseRejectedResult).reason))
    assert.ok(swept.status === 'fulfilled', String((swept as PromiseRejectedResult).reason))

    assert.equal(settled.value, 'rendered')
    assert.equal(swept.value.deleted, 2)
    const left = await fixture.db.pool.query('SELECT 1 FROM processing_figure_render')
    assert.equal(left.rowCount, 0)
    assert.equal(outputs.size, 2, 'one view and one thumbnail, shared by both renders')
    const shared = [...outputs].sort()
    const released = await fixture.db.pool.query<{ digest: string }>(
      "SELECT encode(digest,'hex') AS digest FROM processing_figure_blob_release ORDER BY 1",
    )
    assert.deepEqual(
      released.rows.map((row) => row.digest),
      shared,
    )
  })
})

test('the read shows each figure’s state, and the figure route serves it within the session’s scope', async () => {
  await withFigureSession(async (setup) => {
    const { fixture, tools, token, lot, photoFigure, pageTwoFigure, media, store, binding } = setup
    await fetched(setup, setup.photo)
    await fetched(setup, setup.document, 2)
    const asked = accepted(
      await tools.ask(
        token,
        figureQuestion(lot, [
          photoFigure(),
          photoFigure({ region: { x: 2, y: 2, width: 100, height: 80 } }),
          photoFigure({ region: { x: 3, y: 3, width: 100, height: 80 } }),
          pageTwoFigure(),
        ]),
      ),
    )
    const questionId = asked.id!
    // The second figure's render is held by a live consumer; the third's page can't be rendered.
    const preparing = (await figureRender(setup, questionId, 2))!
    await fixture.db.pool.query(
      'UPDATE processing_figure_render SET lease_owner=$2, lease_expires_at=$3 WHERE id=$1',
      [preparing.id, randomUUID(), new Date(Date.now() + 3_600_000)],
    )
    const renderer = fakeRenderer({
      outcome: (input) => (input.recipe.view.region.x === 3 ? 'malformed' : 'ready'),
    })
    const outcomes = []
    for (let n = 0; n < 4; n += 1) {
      outcomes.push(await renderFigureStep(media.pool, store, binding, renderer))
    }
    assert.deepEqual(outcomes.sort(), ['failed', 'idle', 'rendered', 'rendered'])
    await mediaEditor(fixture.api.pool, fixture.config, setup.batchId).applied({
      kind: 'remove',
      evidence_ids: [setup.document.evidence],
    })

    const read = await fixture.http(`/batches/${setup.batchId}/processing`)
    assert.equal(read.status, 200)
    validate('ProcessingSnapshot', read.value)
    const question = findById(read.value, questionId)
    const figures = question?.figures as ProcessingQuestionFigureDto[]
    assert.deepEqual(
      figures.map((item) => [item.state, item.evidence_label, item.page_width, item.page_height]),
      [
        ['ready', 'IMG_3020', 320, 240],
        ['preparing', 'IMG_3020', 320, 240],
        ['failed', 'IMG_3020', 320, 240],
        ['removed', 'Datasheet', 300, 400],
      ],
    )
    assert.equal(figures[0]!.caption, 'The worn suffix on the label')

    const path = (
      index: number | string,
      size: string,
      batch = setup.batchId,
      job = setup.session.job,
    ) =>
      `/api/v1/batches/${batch}/processing/sessions/${job}/questions/${questionId}/figures/${index}/${size}`
    const get = async (target: string) => {
      const response = await fetch(`${fixture.config.origin}${target}`, {
        headers: { origin: fixture.config.origin },
      })
      return {
        status: response.status,
        type: response.headers.get('content-type'),
        bytes: Buffer.from(await response.arrayBuffer()),
      }
    }
    const ready = (await figureRender(setup, questionId, 1))!
    const view = await get(path(1, 'view'))
    assert.deepEqual([view.status, view.type], [200, 'image/webp'])
    assert.equal(digest(view.bytes), ready.view)
    const thumb = await get(path(1, 'thumb'))
    assert.deepEqual([thumb.status, thumb.type], [200, 'image/webp'])
    assert.equal(digest(thumb.bytes), ready.thumb)
    assert.notEqual(ready.view, ready.thumb)

    const errorCode = (response: { bytes: Buffer }) =>
      JSON.parse(response.bytes.toString('utf8')) as { error?: string; code?: string }
    const pending = await get(path(2, 'view'))
    assert.equal(pending.status, 409)
    assert.match(JSON.stringify(errorCode(pending)), /figure_preparing/)
    const broken = await get(path(3, 'thumb'))
    assert.equal(broken.status, 409)
    assert.match(JSON.stringify(errorCode(broken)), /figure_render_failed/)
    assert.equal((await get(path(4, 'view'))).status, 404, 'a removed photo is gone')
    assert.equal((await get(path(5, 'view'))).status, 404, 'no fifth figure')
    assert.equal((await get(path(6, 'view'))).status, 404, 'index out of range')
    assert.equal((await get(path(0, 'view'))).status, 404, 'index out of range')
    assert.equal((await get(path(1, 'full'))).status, 404, 'unknown size')

    const other = await fixture.seedCapture()
    assert.equal((await get(path(1, 'view', other.batch.id))).status, 404, 'another batch')
    assert.equal((await get(path(1, 'view', setup.batchId, randomUUID()))).status, 404)

    // Another account can't read this batch's figures.
    const stranger = await seedAuthority(fixture.db.pool)
    const foreign = mediaContent(
      fixture.api.pool,
      { actorId: stranger.actor, targetId: stranger.target, targetContextId: stranger.context },
      store,
    )
    await assert.rejects(
      foreign.questionFigure(
        setup.batchId,
        { jobId: setup.session.job, questionId, index: 1 },
        'view',
      ),
      { statusCode: 404 },
    )

    // A view the sweep deleted, as for a photo removed and then restored, isn't made again: the
    // read and the route both say it couldn't be made.
    await fixture.db.pool.query('DELETE FROM processing_figure_render WHERE id=$1', [ready.id])
    const reread = await fixture.http(`/batches/${setup.batchId}/processing`)
    const after = findById(reread.value, questionId)?.figures as ProcessingQuestionFigureDto[]
    assert.equal(after[0]!.state, 'failed')
    const unkept = await get(path(1, 'view'))
    assert.equal(unkept.status, 409)
    assert.match(JSON.stringify(errorCode(unkept)), /figure_render_failed/)
  })
})
