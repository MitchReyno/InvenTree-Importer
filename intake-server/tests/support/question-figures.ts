import { createHash, randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { viewLayout, type MediaViewRecipeDto } from '@invimport/contracts/media'
import type { processingFixture } from './processing.ts'
import { oneStepAsk } from './sessions.ts'
import { database, transaction } from '#/db/database.ts'
import { grantMedia } from '#/media/grants.ts'
import { grantProjection } from '#/operations/grants.ts'
import { grantCaptureRead } from '#/capture/grants.ts'
import type { BlobStore } from '#/media/blob-store.ts'
import type { RenderView, RenderedView, ViewRenderInput } from '#/media/figure-renders.ts'

type Fixture = Awaited<ReturnType<typeof processingFixture>>

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest()

/** A page whose every pixel differs from its neighbours, so a misplaced cut shows. */
export async function patternedPage(width: number, height: number, seed = 0) {
  const pixels = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 3
      pixels[at] = (x + seed) % 256
      pixels[at + 1] = (y + seed * 3) % 256
      pixels[at + 2] = (x * 7 + y * 13 + seed) % 256
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer()
}

/**
 * A ready evidence version with the given page previews in the store, as the decoder leaves a
 * photo (one page) or a PDF (one page image per page). Seeded by the migration owner.
 */
export async function seedPages(
  fixture: Fixture,
  store: BlobStore,
  batchId: string,
  input: { label: string; mediaType: 'image/png' | 'application/pdf'; pages: Buffer[] },
) {
  const original =
    input.mediaType === 'application/pdf'
      ? Buffer.from(`%PDF-1.7\n% ${input.label} ${randomUUID()}\n`)
      : input.pages[0]!
  const ids = { evidence: randomUUID(), version: randomUUID(), decode: randomUUID() }
  const sizes: { width: number; height: number }[] = []
  for (const page of input.pages) {
    const metadata = await sharp(page).metadata()
    sizes.push({ width: metadata.width!, height: metadata.height! })
  }
  await transaction(fixture.db.pool, async (client) => {
    await store.publish(client, original)
    for (const page of input.pages) {
      await store.publish(client, page)
    }
    await client.query('INSERT INTO media_batch(batch_id) VALUES($1) ON CONFLICT DO NOTHING', [
      batchId,
    ])
    for (const bytes of [original, ...input.pages]) {
      await client.query(
        'INSERT INTO media_blob(digest,byte_size) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [sha(bytes), bytes.length.toString()],
      )
    }
    await client.query(
      'INSERT INTO media_evidence(id,batch_id,label,actor_id) VALUES($1,$2,$3,$4)',
      [ids.evidence, batchId, input.label, fixture.identity.actor],
    )
    await client.query(
      `INSERT INTO media_version(id,batch_id,evidence_id,kind,blob_digest,media_type,actor_id)
       VALUES($1,$2,$3,'original',$4,$5,$6)`,
      [ids.version, batchId, ids.evidence, sha(original), input.mediaType, fixture.identity.actor],
    )
    await client.query(
      "INSERT INTO media_decode_command(id,batch_id,version_id,build) VALUES($1,$2,$3,'figure-fixture/1')",
      [ids.decode, batchId, ids.version],
    )
    await client.query(
      "INSERT INTO media_decode_result(command_id,state,decoder_build) VALUES($1,'ready','figure-fixture/1')",
      [ids.decode],
    )
    for (const [index, page] of input.pages.entries()) {
      await client.query(
        `INSERT INTO media_preview(id,batch_id,version_id,command_id,page,width,height,blob_digest)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          randomUUID(),
          batchId,
          ids.version,
          ids.decode,
          index + 1,
          sizes[index]!.width,
          sizes[index]!.height,
          sha(page),
        ],
      )
    }
  })
  return {
    ...ids,
    sizes,
    source: {
      kind: 'media_version' as const,
      evidence_id: ids.evidence,
      version_id: ids.version,
      sha256: sha(original).toString('hex'),
    },
  }
}

/** Links evidence to a lot, so a lot session opened afterwards has it in its manifest. */
export async function linkToLot(
  fixture: Fixture,
  batchId: string,
  evidenceId: string,
  lotId: string,
  revision: number,
) {
  await fixture.db.pool.query(
    'INSERT INTO media_subject_link(id,batch_id,evidence_id,subject_id,linked,revision,actor_id) VALUES($1,$2,$3,$4,true,$5,$6)',
    [randomUUID(), batchId, evidenceId, lotId, revision, fixture.identity.actor],
  )
}

/** A media role provisioned as deployment and `pnpm dev` provision the decoder's role. */
export async function mediaRole(fixture: Fixture) {
  const name = `intake_media_${randomUUID().replaceAll('-', '')}`
  const password = randomUUID()
  await fixture.db.pool.query(
    `CREATE ROLE ${name} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 8`,
  )
  await grantMedia(fixture.db.pool, name, 'decoder')
  await grantProjection(fixture.db.pool, name)
  await grantCaptureRead(fixture.db.pool, name)
  const url = new URL(fixture.db.url)
  url.username = name
  url.password = password
  const connection = database(url.toString())
  return {
    name,
    url: url.toString(),
    pool: connection.pool,
    async close() {
      await connection.close()
      await fixture.db.pool.query(`DROP OWNED BY ${name}`)
      await fixture.db.pool.query(`DROP ROLE ${name}`)
    },
  }
}

export interface FigureSpec {
  evidence_id: string
  version_id: string
  page: number
  region: { x: number; y: number; width: number; height: number }
  quarterTurns?: number
  label?: string
}

/** One figure in the agent's `ask` shape, with a box mark and a caption. */
export function figure(spec: FigureSpec) {
  return {
    source: {
      kind: 'evidence_page',
      evidence_id: spec.evidence_id,
      version_id: spec.version_id,
      page: spec.page,
    },
    view: {
      region: spec.region,
      quarter_turns: spec.quarterTurns ?? 0,
      straighten_millidegrees: 0,
    },
    marks: [
      {
        kind: 'box',
        geometry: { x: 2000, y: 2500, width: 5000, height: 4000 },
        label: spec.label ?? 'Worn suffix',
      },
    ],
    caption: 'The worn suffix on the label',
    why: 'It decides which variant this packet holds.',
  }
}

/** A one-step `/2` question about a lot, carrying the given figures. */
export function figureQuestion(lotId: string, figures: unknown[] | undefined, preview = false) {
  return {
    ...oneStepAsk({
      kind: 'clarification',
      subject_id: lotId,
      prompt: 'Is the last letter of the suffix a B?',
      reason: 'The suffix is worn.',
      fields: ['identity'],
      assumption: 'Treating it as no suffix.',
    }),
    ...(figures ? { figures } : {}),
    ...(preview ? { preview: true } : {}),
  }
}

/** A solid image of the given size and format, its colour taken from `key`. */
async function solid(width: number, height: number, key: string, format: 'webp' | 'png') {
  const tint = createHash('sha256').update(key).digest()
  const image = sharp({
    create: { width, height, channels: 3, background: { r: tint[0]!, g: tint[1]!, b: tint[2]! } },
  })
  return format === 'webp' ? image.webp({ lossless: true }).toBuffer() : image.png().toBuffer()
}

/**
 * A stand-in for the decoder's `render_view`: a view and thumbnail of the recipe's layout size,
 * and a marked preview when marks are given, each coloured by its recipe and marks so different
 * renders have different bytes. `preview` replaces the marked preview's pixels.
 */
export function fakeRenderer(
  options: { preview?: Buffer; outcome?: (input: ViewRenderInput) => 'ready' | 'malformed' } = {},
): RenderView & { calls: ViewRenderInput[] } {
  const calls: ViewRenderInput[] = []
  const render = async (input: ViewRenderInput): Promise<RenderedView> => {
    calls.push(input)
    if (options.outcome?.(input) === 'malformed') {
      return { state: 'malformed' }
    }
    const layout = viewLayout(input.recipe)
    const key = JSON.stringify([input.recipe, input.marks])
    const view = await solid(layout.width, layout.height, key, 'webp')
    const thumb = await solid(layout.thumbWidth, layout.thumbHeight, key + ':thumb', 'webp')
    let preview = null
    if (input.marks !== null) {
      const bytes = options.preview ?? (await solid(layout.width, layout.height, key, 'png'))
      const metadata = await sharp(bytes).metadata()
      preview = { bytes, width: metadata.width!, height: metadata.height! }
    }
    return {
      state: 'ready',
      view: { bytes: view, width: layout.width, height: layout.height },
      thumb: { bytes: thumb, width: layout.thumbWidth, height: layout.thumbHeight },
      preview,
    }
  }
  return Object.assign(render, { calls })
}

/** The rendered sizes a recipe's view takes, for asserting a real render. */
export function expectedLayout(recipe: MediaViewRecipeDto) {
  const layout = viewLayout(recipe)
  return { width: layout.width, height: layout.height }
}

/** What the ask path stored for a job, read by the migration owner. */
export async function storedFigures(fixture: Fixture, jobId: string, batchId: string) {
  const rows = await fixture.db.pool.query<{
    questions: number
    figures: number
    views: number
    previews: number
    outbox: number
  }>(
    `SELECT (SELECT count(*)::int FROM processing_question WHERE job_id=$1) AS questions,
       (SELECT count(*)::int FROM processing_question_figure f JOIN processing_question q
         ON q.id=f.question_id WHERE q.job_id=$1) AS figures,
       (SELECT count(*)::int FROM processing_figure_render WHERE batch_id=$2 AND purpose='view') AS views,
       (SELECT count(*)::int FROM processing_figure_render WHERE batch_id=$2 AND purpose='preview') AS previews,
       (SELECT count(*)::int FROM agent_session_outbox o JOIN processing_attempt a ON a.id=o.session_id
         WHERE a.job_id=$1 AND o.kind='question') AS outbox`,
    [jobId, batchId],
  )
  return rows.rows[0]!
}

/** `processing_changed` events on the batch's stream. */
export async function processingChanged(fixture: Fixture, batchId: string) {
  const rows = await fixture.db.pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM ui_event e JOIN capture_batch b ON b.stream_id=e.stream_id
     WHERE b.id=$1 AND e.kind='processing_changed'`,
    [batchId],
  )
  return rows.rows[0]!.count
}
