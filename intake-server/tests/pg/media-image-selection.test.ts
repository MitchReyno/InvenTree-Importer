import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import {
  validate,
  type CaptureSnapshotDto,
  type MediaEditDto,
  type MediaLitViewRecipeDto,
  type MediaSnapshotDto,
} from '@invimport/contracts'
import { BlobStore } from '#/media/blob-store.ts'
import { readMediaStoreIdentity } from '#/media/store-identity.ts'
import { grantMedia } from '#/media/grants.ts'
import { grantProjection } from '#/operations/grants.ts'
import { grantCaptureRead } from '#/capture/grants.ts'
import { captureRepository } from '#/capture/repository.ts'
import { mediaRepository } from '#/media/repository.ts'
import { operatorRepository } from '#/operator-review/repository.ts'
import { processMediaCommand } from '#/media/worker.ts'
import { imageSelections } from '#/media/image-selections.ts'
import { decodeMediaInputs, scopeMediaInputs } from '#/media/inputs.ts'
import { database, transaction } from '#/db/database.ts'
import { isolatedDatabase, seedAuthority } from '../support/database.ts'
import { mediaEditor, seedStoredPhoto } from '../support/media-removal.ts'

const image = process.env.INTAKE_MEDIA_DECODER_IMAGE
const skipDecoder = image ? false : 'Explicit decoder image needed for PG/decoder boundary'

type Photo = Awaited<ReturnType<typeof seedStoredPhoto>>
type SelectImages = Extract<MediaEditDto['change'], { kind: 'select_images' }>
type Region = MediaLitViewRecipeDto['view']['region']

function captureValue(value: unknown): CaptureSnapshotDto {
  validate('CaptureSnapshot', value)
  return value as CaptureSnapshotDto
}

function hex(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex')
}

const plainLight: MediaLitViewRecipeDto['light'] = {
  white_balance: false,
  contrast_clip_permille: null,
  gamma_thousandths: null,
  sharpen: false,
}

/** A recipe `/2` on the seeded photo's one 32×24 page. */
function lit(
  photo: Photo,
  region: Region,
  overrides: Partial<MediaLitViewRecipeDto> = {},
): MediaLitViewRecipeDto {
  return {
    version: 'bench-intake-view/2',
    source_version_id: photo.version,
    source_digest: hex(photo.original),
    page: 1,
    page_width: 32,
    page_height: 24,
    view: { region, quarter_turns: 0, straighten_millidegrees: 0 },
    light: plainLight,
    ...overrides,
  }
}

function selectImages(
  lotId: string,
  partImage: MediaLitViewRecipeDto | null,
  stockImages: MediaLitViewRecipeDto[],
): SelectImages {
  return {
    kind: 'select_images',
    subject_id: lotId,
    part_image: partImage,
    stock_images: stockImages,
  }
}

function refusal(result: MediaSnapshotDto | { refused: string; status: number }) {
  if ('refused' in result) {
    return [result.status, result.refused]
  }
  return [200, 'applied']
}

/** A batch with three lots, an editor and the owner pool for direct reads. */
async function selectionFixture() {
  const db = await isolatedDatabase()
  const root = await realpath(await mkdtemp(join(tmpdir(), 'intake-image-selection-')))
  const identity = await seedAuthority(db.pool)
  const binding = {
    actorId: identity.actor,
    targetId: identity.target,
    targetContextId: identity.context,
  }
  const store = await BlobStore.initialize(root, await readMediaStoreIdentity(db.pool))
  const capture = captureRepository(db.pool, binding)
  let batch = captureValue(await capture.create(randomUUID(), { title: 'Images', note: '' }))
  for (const label of ['Packet A', 'Packet B', 'Packet C']) {
    batch = captureValue(
      await capture.edit(batch.id, randomUUID(), {
        expected_revision: batch.revision,
        change: { kind: 'add_lot', label, note: '', part_subject_id: null },
      }),
    )
  }
  const lots = batch.lots.map((lot) => lot.id)
  const media = mediaEditor(db.pool, binding, batch.id)

  function seed(label: string, seedNumber: number) {
    return seedStoredPhoto(db.pool, store, {
      batchId: batch.id,
      actorId: identity.actor,
      label,
      seed: seedNumber,
    })
  }

  function selections() {
    return transaction(db.pool, (client) => imageSelections(client, batch.id))
  }

  async function counts() {
    const result = await db.pool.query<Record<string, number>>(
      `SELECT (SELECT count(*)::int FROM media_derivation) AS derivations,
              (SELECT count(*)::int FROM media_decode_command WHERE derivation_id IS NOT NULL)
                AS commands,
              (SELECT count(*)::int FROM media_image_selection) AS selections,
              (SELECT count(*)::int FROM media_image_selection_item) AS items`,
    )
    return result.rows[0]
  }

  async function dispose() {
    await db.dispose()
    await rm(root, { recursive: true, force: true })
  }

  return {
    db,
    root,
    identity,
    binding,
    store,
    batch,
    lots,
    media,
    seed,
    selections,
    counts,
    dispose,
  }
}

test('a Part image and two stock images are confirmed in order as queued derived crops', async () => {
  const fixture = await selectionFixture()
  try {
    const photo = await fixture.seed('Bench photo', 1)
    const [lotA] = fixture.lots
    const part = lit(photo, { x: 0, y: 0, width: 16, height: 12 })
    const first = lit(
      photo,
      { x: 8, y: 6, width: 16, height: 12 },
      {
        light: { ...plainLight, white_balance: true, gamma_thousandths: 1200 },
      },
    )
    // A straightening below zero must survive the edit's canonical bytes.
    const second = lit(
      photo,
      { x: 10, y: 4, width: 12, height: 12 },
      {
        view: {
          region: { x: 10, y: 4, width: 12, height: 12 },
          quarter_turns: 1,
          straighten_millidegrees: -3500,
        },
      },
    )
    const before = await fixture.media.snapshot()
    const events = await fixture.db.pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM ui_event WHERE kind='media_changed'",
    )

    const after = await fixture.media.applied(selectImages(lotA, part, [first, second]))

    assert.equal(after.revision, (BigInt(before.revision) + 1n).toString())
    const selections = await fixture.selections()
    assert.equal(selections.length, 1)
    const selection = selections[0]
    validate('ProcessingImageSelection', selection)
    assert.equal(selection.lot_id, lotA)
    assert.equal(selection.revision, after.revision)
    assert.deepEqual(selection.part_image?.recipe, part)
    assert.deepEqual(
      selection.stock_images.map((item) => item.recipe),
      [first, second],
    )
    const items = [selection.part_image!, ...selection.stock_images]
    assert.deepEqual(
      items.map((item) => item.state),
      ['queued', 'queued', 'queued'],
    )
    assert.equal(new Set(items.map((item) => item.version_id)).size, 3)
    // Each is a derivation of the photo with its own decode command, as Capture's crops are.
    const derivations = await fixture.db.pool.query<{ id: string; evidence_id: string }>(
      `SELECT d.id, d.evidence_id FROM media_derivation d
       JOIN media_decode_command c ON c.derivation_id=d.id AND c.version_id=d.source_version_id
       ORDER BY d.id`,
    )
    assert.deepEqual(
      derivations.rows.map((row) => row.id),
      items.map((item) => item.version_id).sort(),
    )
    assert.ok(derivations.rows.every((row) => row.evidence_id === photo.evidence))
    // The snapshot projects the retained recipe `/2` of each queued derivation.
    const projected = new Map(after.derivations.map((derivation) => [derivation.id, derivation]))
    assert.deepEqual(
      items.map((item) => projected.get(item.version_id)?.recipe),
      [part, first, second],
    )
    const rows = await fixture.db.pool.query<{
      role: string
      position: number
      derivation_id: string
    }>(
      `SELECT i.role, i.position, i.derivation_id FROM media_image_selection_item i
       ORDER BY i.position`,
    )
    assert.deepEqual(
      rows.rows.map((row) => [row.role, row.position, row.derivation_id]),
      [
        ['part_image', 0, items[0].version_id],
        ['stock_image', 1, items[1].version_id],
        ['stock_image', 2, items[2].version_id],
      ],
    )
    const later = await fixture.db.pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM ui_event WHERE kind='media_changed'",
    )
    assert.equal(later.rows[0].count, events.rows[0].count + 1)
  } finally {
    await fixture.dispose()
  }
})

test('confirming the same crop again reuses its derivation, in any lot and order', async () => {
  const fixture = await selectionFixture()
  try {
    const photo = await fixture.seed('Bench photo', 2)
    const [lotA, lotB] = fixture.lots
    const left = lit(photo, { x: 0, y: 0, width: 16, height: 24 })
    const right = lit(photo, { x: 16, y: 0, width: 16, height: 24 })
    await fixture.media.applied(selectImages(lotA, null, [left, right]))
    const first = (await fixture.selections())[0]

    await fixture.media.applied(selectImages(lotA, null, [right, left]))
    await fixture.media.applied(selectImages(lotB, right, []))

    assert.equal((await fixture.counts()).derivations, 2)
    assert.equal((await fixture.counts()).commands, 2)
    const [a, b] = await fixture.selections()
    assert.equal(a.lot_id, lotA)
    assert.deepEqual(
      a.stock_images.map((item) => item.version_id),
      [first.stock_images[1].version_id, first.stock_images[0].version_id],
    )
    assert.equal(b.lot_id, lotB)
    assert.equal(b.part_image?.version_id, first.stock_images[1].version_id)
    assert.deepEqual(b.stock_images, [])
  } finally {
    await fixture.dispose()
  }
})

test('recipes that do not name a present original page, retired lots and stale revisions are refused', async () => {
  const fixture = await selectionFixture()
  try {
    const photo = await fixture.seed('Bench photo', 3)
    const removed = await fixture.seed('Removed photo', 4)
    const [lotA, lotB] = fixture.lots
    await fixture.media.applied({ kind: 'remove', evidence_ids: [removed.evidence] })
    const region = { x: 0, y: 0, width: 16, height: 12 }
    const good = lit(photo, region)
    const before = await fixture.media.snapshot()
    const baseline = await fixture.counts()

    const cases: [string, SelectImages, [number, string]][] = [
      [
        'removed photo',
        selectImages(lotA, lit(removed, region), []),
        [409, 'media_evidence_removed'],
      ],
      [
        'unknown version',
        selectImages(lotA, null, [{ ...good, source_version_id: randomUUID() }]),
        [409, 'invalid_recipe_source'],
      ],
      [
        'wrong digest',
        selectImages(lotA, null, [{ ...good, source_digest: hex(removed.original) }]),
        [409, 'invalid_recipe_source'],
      ],
      [
        'wrong page size',
        selectImages(lotA, null, [{ ...good, page_width: 64, page_height: 48 }]),
        [409, 'invalid_recipe_source'],
      ],
      [
        'missing page',
        selectImages(lotA, null, [{ ...good, page: 2 }]),
        [409, 'invalid_recipe_source'],
      ],
      [
        'region outside the page',
        selectImages(lotA, null, [lit(photo, { x: 20, y: 0, width: 16, height: 12 })]),
        [409, 'invalid_recipe_source'],
      ],
      ['duplicate recipe', selectImages(lotA, good, [good]), [422, 'duplicate_image_recipe']],
      ['unknown lot', selectImages(randomUUID(), good, []), [404, 'not_found']],
      // One bad recipe refuses the whole set, so no derivation of the good one is left behind.
      [
        'good then bad',
        selectImages(lotA, good, [{ ...good, page: 2 }]),
        [409, 'invalid_recipe_source'],
      ],
    ]
    for (const [name, change, expected] of cases) {
      assert.deepEqual(refusal(await fixture.media.edit(change)), expected, name)
    }
    assert.deepEqual(
      refusal(await fixture.media.edit(selectImages(lotA, good, []), { revision: '1' })),
      [412, 'revision_conflict'],
    )
    assert.equal((await fixture.media.snapshot()).revision, before.revision)
    assert.deepEqual(await fixture.counts(), baseline)

    // A lot retired by a split keeps its history and takes no new images.
    const capture = captureRepository(fixture.db.pool, fixture.binding)
    const current = captureValue(await capture.read(fixture.batch.id))
    await operatorRepository(fixture.db.pool, {
      ...fixture.binding,
      origin: 'http://127.0.0.1:9',
      credentialRef: 'owned-test',
    }).restructure(fixture.batch.id, randomUUID(), {
      expected_revision: current.revision,
      preview: false,
      change: {
        kind: 'split_lot',
        lot_id: lotB,
        children: [
          { label: 'Half one', quantity: '1' },
          { label: 'Half two', quantity: '1' },
        ],
      },
    })
    assert.deepEqual(refusal(await fixture.media.edit(selectImages(lotB, good, []))), [
      409,
      'lot_retired',
    ])
    assert.deepEqual(await fixture.counts(), baseline)
  } finally {
    await fixture.dispose()
  }
})

test('an empty confirmation clears the lot’s images', async () => {
  const fixture = await selectionFixture()
  try {
    const photo = await fixture.seed('Bench photo', 5)
    const [lotA] = fixture.lots
    await fixture.media.applied(
      selectImages(lotA, lit(photo, { x: 0, y: 0, width: 8, height: 8 }), []),
    )
    assert.equal((await fixture.selections()).length, 1)

    const cleared = await fixture.media.applied(selectImages(lotA, null, []))

    assert.deepEqual(await fixture.selections(), [])
    const rows = await fixture.db.pool.query<{ revision: string; items: number }>(
      `SELECT s.revision::text, (SELECT count(*)::int FROM media_image_selection_item i
         WHERE i.selection_id=s.id) AS items
       FROM media_image_selection s ORDER BY s.revision`,
    )
    assert.deepEqual(
      rows.rows.map((row) => [row.revision, row.items]),
      [
        [(BigInt(cleared.revision) - 1n).toString(), 1],
        [cleared.revision, 0],
      ],
    )
  } finally {
    await fixture.dispose()
  }
})

test('removing a photo clears its crops from every lot’s current images, and restoring keeps them cleared', async () => {
  const fixture = await selectionFixture()
  try {
    const removedPhoto = await fixture.seed('Packet label', 6)
    const keptPhoto = await fixture.seed('Tray', 7)
    const [lotA, lotB, lotC] = fixture.lots
    const removedPart = lit(removedPhoto, { x: 0, y: 0, width: 16, height: 12 })
    const removedStock = lit(removedPhoto, { x: 16, y: 12, width: 16, height: 12 })
    const keptStock = lit(keptPhoto, { x: 4, y: 4, width: 20, height: 16 })
    const keptPart = lit(keptPhoto, { x: 0, y: 0, width: 10, height: 10 })
    await fixture.media.applied(selectImages(lotA, removedPart, [removedStock, keptStock]))
    await fixture.media.applied(selectImages(lotB, null, [removedStock]))
    await fixture.media.applied(selectImages(lotC, keptPart, [keptStock]))
    const before = await fixture.selections()
    const lotCRows = await fixture.db.pool.query(
      'SELECT id FROM media_image_selection WHERE subject_id=$1',
      [lotC],
    )

    const removed = await fixture.media.applied({
      kind: 'remove',
      evidence_ids: [removedPhoto.evidence],
    })

    const after = await fixture.selections()
    assert.deepEqual(
      after.map((selection) => selection.lot_id),
      [lotA, lotC].sort(),
    )
    const a = after.find((selection) => selection.lot_id === lotA)!
    assert.equal(a.revision, removed.revision)
    assert.equal(a.part_image, null)
    assert.deepEqual(
      a.stock_images.map((item) => item.recipe),
      [keptStock],
    )
    assert.deepEqual(
      after.find((selection) => selection.lot_id === lotC),
      before.find((selection) => selection.lot_id === lotC),
    )
    const lotCAfter = await fixture.db.pool.query(
      'SELECT id FROM media_image_selection WHERE subject_id=$1',
      [lotC],
    )
    assert.equal(lotCAfter.rowCount, lotCRows.rowCount)
    const positions = await fixture.db.pool.query<{ position: number }>(
      `SELECT i.position FROM media_image_selection_item i
       JOIN media_image_selection s ON s.id=i.selection_id
       WHERE s.subject_id=$1 AND s.revision=$2`,
      [lotA, removed.revision],
    )
    assert.deepEqual(
      positions.rows.map((row) => row.position),
      [1],
    )

    await fixture.media.applied({ kind: 'restore', evidence_ids: [removedPhoto.evidence] })

    assert.deepEqual(await fixture.selections(), after)
  } finally {
    await fixture.dispose()
  }
})

test(
  'the worker derives a confirmed recipe `/2` into a ready derived version',
  { skip: skipDecoder },
  async () => {
    const fixture = await selectionFixture()
    const name = `intake_images_${randomUUID().replaceAll('-', '')}`
    const password = randomUUID()
    await fixture.db.pool.query(
      `CREATE ROLE ${name} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 4`,
    )
    await grantProjection(fixture.db.pool, name)
    await grantCaptureRead(fixture.db.pool, name)
    await grantMedia(fixture.db.pool, name, 'decoder')
    const url = new URL(fixture.db.url)
    url.username = name
    url.password = password
    const decoder = database(url.toString())
    try {
      const bytes = await sharp({
        create: { width: 120, height: 80, channels: 3, background: { r: 150, g: 110, b: 70 } },
      })
        .jpeg()
        .toBuffer()
      const repository = mediaRepository(fixture.db.pool, fixture.binding, fixture.store)
      const revision = (await fixture.media.snapshot()).revision
      const receipt = await repository.upload(
        fixture.batch.id,
        randomUUID(),
        revision,
        'Bag',
        bytes,
      )
      validate('MediaReceipt', receipt)
      assert.equal(
        await processMediaCommand(decoder.pool, fixture.store, fixture.binding, image!),
        true,
      )
      const original = (await fixture.media.snapshot()).evidence[0].versions[0]
      assert.equal(original.state, 'ready')
      const page = original.pages[0]
      const recipe: MediaLitViewRecipeDto = {
        version: 'bench-intake-view/2',
        source_version_id: original.id,
        source_digest: original.digest,
        page: 1,
        page_width: page.width,
        page_height: page.height,
        view: {
          region: { x: 10, y: 10, width: 60, height: 40 },
          quarter_turns: 1,
          straighten_millidegrees: -3500,
        },
        light: { ...plainLight, white_balance: true },
      }
      const [lotA] = fixture.lots
      await fixture.media.applied(selectImages(lotA, null, [recipe]))
      assert.equal((await fixture.selections())[0].stock_images[0].state, 'queued')

      assert.equal(
        await processMediaCommand(decoder.pool, fixture.store, fixture.binding, image!),
        true,
      )

      const item = (await fixture.selections())[0].stock_images[0]
      assert.equal(item.state, 'ready')
      assert.deepEqual(item.recipe, recipe)
      const snapshot = await fixture.media.snapshot()
      const derived = snapshot.evidence[0].versions.find(
        (version) => version.id === item.version_id,
      )
      assert.ok(derived)
      assert.equal(derived.kind, 'derived')
      assert.equal(derived.state, 'ready')
      assert.equal(derived.media_type, 'image/png')
      assert.deepEqual(derived.recipe, recipe)
      assert.equal(derived.pages.length, 1)
      // A quarter turn swaps the axes; the corner guard shrinks the straightened window.
      assert.ok(
        derived.pages[0].width <= 40 && derived.pages[0].width > 30,
        `${derived.pages[0].width}`,
      )
      assert.ok(derived.pages[0].height <= 60 && derived.pages[0].height > 45)

      // A lit crop's version, negative straightening included, round-trips through media inputs.
      const attached = await fixture.media.applied({
        kind: 'select_attachment',
        subject_id: lotA,
        mode: 'selected',
        version_id: derived.id,
        destination: 'lot_attachment',
      })
      const inputs = scopeMediaInputs(attached, [lotA])
      const decoded = decodeMediaInputs(inputs.bytes, inputs.digest)
      assert.deepEqual(
        decoded.versions.find((version) => version.versionId === derived.id)?.recipe,
        recipe,
      )

      // A derived crop is not a source for another.
      const fromDerived = {
        ...recipe,
        source_version_id: derived.id,
        source_digest: derived.digest,
        page_width: derived.pages[0].width,
        page_height: derived.pages[0].height,
        view: {
          region: { x: 0, y: 0, width: 10, height: 10 },
          quarter_turns: 0,
          straighten_millidegrees: 0,
        },
      }
      assert.deepEqual(refusal(await fixture.media.edit(selectImages(lotA, fromDerived, []))), [
        409,
        'invalid_recipe_source',
      ])
    } finally {
      await decoder.pool.end()
      await fixture.db.pool.query(`DROP OWNED BY ${name}`)
      await fixture.db.pool.query(`DROP ROLE ${name}`)
      await fixture.dispose()
    }
  },
)
