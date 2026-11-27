import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { MediaEvidence, MediaSnapshot, viewLayout } from '@invimport/contracts/media'
import type {
  CaptureSnapshotDto,
  MediaEditDto,
  MediaEvidenceDto,
  MediaLitViewRecipeDto,
  MediaSnapshotDto,
} from '@invimport/contracts'
import { sha256 } from '#/db/authority.ts'
import { executeDatabaseQuery, queryDatabase } from '#/db/database.ts'
import { fail, type CaptureBinding } from '#/capture/model.ts'
import { canonicalMedia } from './encoding.ts'
import { reservedVersionCount, requireActiveLot } from './edit-checks.ts'
import { currentImageSelections, type ImageRole } from './image-selections.ts'
import { mediaSnapshot } from './read.ts'
import { removedVersionIds } from './removal.ts'
import { DECODER_BUILD } from './repository.ts'
import {
  mediaDecodeCommands,
  mediaDerivations,
  mediaImageSelectionItems,
  mediaImageSelections,
} from './schema.ts'

type SelectImagesChange = Extract<MediaEditDto['change'], { kind: 'select_images' }>

/** One image of a set the operator confirmed, with its retained recipe bytes. */
interface ConfirmedImage {
  role: ImageRole
  position: number
  recipe: MediaLitViewRecipeDto
  bytes: Buffer
  digest: Buffer
}

/** An image of a selection row, by the derivation that crops it. */
export interface SelectedImage {
  role: ImageRole
  position: number
  derivationId: string
}

interface SelectionWrite {
  batchId: string
  revision: string
  lotId: string
  images: readonly SelectedImage[]
}

const MAX_DERIVATIONS = MediaSnapshot.properties.derivations.maxItems!
const MAX_EVIDENCE_VERSIONS = MediaEvidence.properties.versions.maxItems!

/** The Part image is position 0; stock images follow from 1 in the operator's order. */
function confirmedImages(change: SelectImagesChange): ConfirmedImage[] {
  const ordered: { role: ImageRole; recipe: MediaLitViewRecipeDto }[] = []
  if (change.part_image) {
    ordered.push({ role: 'part_image', recipe: change.part_image })
  }
  for (const recipe of change.stock_images) {
    ordered.push({ role: 'stock_image', recipe })
  }
  const images = ordered.map((image, index) => {
    const bytes = Buffer.from(canonicalMedia(image.recipe))
    const position = change.part_image ? index : index + 1
    return { ...image, position, bytes, digest: sha256(bytes) }
  })
  const digests = new Set(images.map((image) => image.digest.toString('hex')))
  if (digests.size !== images.length) {
    fail('duplicate_image_recipe')
  }
  return images
}

function requireLot(capture: CaptureSnapshotDto, lotId: string) {
  if (!capture.lots.some((lot) => lot.id === lotId)) {
    fail('not_found', 404)
  }
  requireActiveLot(capture, lotId)
}

/** The recipe must name a ready original's decoded page at its size, with a region on the page. */
function requireRecipeSource(snapshot: MediaSnapshotDto, recipe: MediaLitViewRecipeDto) {
  const evidence = snapshot.evidence.find((item) =>
    item.versions.some((version) => version.id === recipe.source_version_id),
  )
  const source = evidence?.versions.find((version) => version.id === recipe.source_version_id)
  const page = source?.pages.find((item) => item.page === recipe.page)
  if (
    !evidence ||
    !source ||
    source.kind !== 'original' ||
    source.state !== 'ready' ||
    source.digest !== recipe.source_digest ||
    !page ||
    page.width !== recipe.page_width ||
    page.height !== recipe.page_height
  ) {
    fail('invalid_recipe_source', 409)
  }
  try {
    viewLayout(recipe, 'full')
  } catch {
    fail('invalid_recipe_source', 409)
  }
  return evidence
}

/**
 * Earlier derivations of these recipes that are queued or ready, by recipe digest. One that
 * failed is not reused, so confirming it again requests a fresh decode.
 */
async function reusableDerivations(client: PoolClient, batchId: string, digests: Buffer[]) {
  if (!digests.length) {
    return new Map<string, string>()
  }
  const reusable = await client.query<{ id: string; recipe_digest: Buffer }>(
    `SELECT DISTINCT ON (d.recipe_digest) d.id, d.recipe_digest
     FROM public.media_derivation d
     JOIN public.media_decode_command c ON c.derivation_id = d.id
     LEFT JOIN public.media_decode_result r ON r.command_id = c.id
     WHERE d.batch_id = $1
       AND d.recipe_digest = ANY($2::bytea[])
       AND (r.state IS NULL OR r.state = 'ready')
     ORDER BY d.recipe_digest, d.created_at, d.id`,
    [batchId, digests],
  )
  return new Map(reusable.rows.map((row) => [row.recipe_digest.toString('hex'), row.id]))
}

/** Requests a decode of a new derivation, as Capture's crops are requested. */
async function requestLitDerivation(
  client: PoolClient,
  binding: CaptureBinding,
  batchId: string,
  evidenceId: string,
  image: ConfirmedImage,
) {
  const derivationId = randomUUID()
  const db = queryDatabase(client)
  await executeDatabaseQuery(
    db.insert(mediaDerivations).values({
      id: derivationId,
      batchId,
      evidenceId,
      sourceVersionId: image.recipe.source_version_id,
      recipeBytes: image.bytes,
      recipeDigest: image.digest,
      actorId: binding.actorId,
    }),
  )
  await executeDatabaseQuery(
    db.insert(mediaDecodeCommands).values({
      id: randomUUID(),
      batchId,
      versionId: image.recipe.source_version_id,
      derivationId,
      build: DECODER_BUILD,
    }),
  )
  return derivationId
}

/** Reuses or requests each image's derivation, within the batch's and each item's capacity. */
async function retainDerivations(
  client: PoolClient,
  binding: CaptureBinding,
  batchId: string,
  snapshot: MediaSnapshotDto,
  sources: { image: ConfirmedImage; evidence: MediaEvidenceDto }[],
) {
  const reusable = await reusableDerivations(
    client,
    batchId,
    sources.map((source) => source.image.digest),
  )
  let requested = 0
  const requestedByEvidence = new Map<string, number>()
  const selected: SelectedImage[] = []
  for (const { image, evidence } of sources) {
    let derivationId = reusable.get(image.digest.toString('hex'))
    if (!derivationId) {
      const evidenceRequested = requestedByEvidence.get(evidence.id) ?? 0
      const batchFull = snapshot.derivations.length + requested >= MAX_DERIVATIONS
      const evidenceFull =
        reservedVersionCount(evidence, snapshot) + evidenceRequested >= MAX_EVIDENCE_VERSIONS
      if (batchFull || evidenceFull) {
        fail('media_capacity', 409)
      }
      derivationId = await requestLitDerivation(client, binding, batchId, evidence.id, image)
      requested += 1
      requestedByEvidence.set(evidence.id, evidenceRequested + 1)
    }
    selected.push({ role: image.role, position: image.position, derivationId })
  }
  return selected
}

/** Appends a lot's selection row at this revision; no images clears the lot's images. */
export async function writeImageSelection(
  client: PoolClient,
  binding: CaptureBinding,
  selection: SelectionWrite,
) {
  const selectionId = randomUUID()
  const db = queryDatabase(client)
  await executeDatabaseQuery(
    db.insert(mediaImageSelections).values({
      id: selectionId,
      batchId: selection.batchId,
      subjectId: selection.lotId,
      revision: selection.revision,
      actorId: binding.actorId,
    }),
  )
  if (!selection.images.length) {
    return
  }
  await executeDatabaseQuery(
    db.insert(mediaImageSelectionItems).values(
      selection.images.map((image) => ({
        selectionId,
        batchId: selection.batchId,
        role: image.role,
        position: image.position,
        derivationId: image.derivationId,
      })),
    ),
  )
}

/**
 * Confirms a lot's images: each recipe `/2` becomes a derived crop of its original, reusing an
 * identical earlier one, and the set replaces the lot's confirmed images.
 */
export async function selectImages(
  client: PoolClient,
  binding: CaptureBinding,
  request: { batchId: string; revision: string; change: SelectImagesChange },
  capture: CaptureSnapshotDto,
) {
  const { batchId, revision, change } = request
  requireLot(capture, change.subject_id)
  const images = confirmedImages(change)
  const sourceIds = [...new Set(images.map((image) => image.recipe.source_version_id))]
  const removed = await removedVersionIds(client, batchId, sourceIds)
  if (removed.size) {
    fail('media_evidence_removed', 409)
  }
  const snapshot = await mediaSnapshot(client, binding, batchId)
  const sources = images.map((image) => ({
    image,
    evidence: requireRecipeSource(snapshot, image.recipe),
  }))
  // A lot's images come from its own photos now: linked to it, or holding one of its observations.
  for (const { evidence } of sources) {
    if (!evidence.linked_subject_ids.includes(change.subject_id)) {
      fail('image_source_outside_lot', 409)
    }
  }
  const selected = await retainDerivations(client, binding, batchId, snapshot, sources)
  await writeImageSelection(client, binding, {
    batchId,
    revision,
    lotId: change.subject_id,
    images: selected,
  })
}

/**
 * Takes crops of removed items out of every lot's current images, writing each affected lot a
 * new selection at the removal's revision. A later restore leaves them out.
 */
export async function clearRemovedImages(
  client: PoolClient,
  binding: CaptureBinding,
  removal: { batchId: string; revision: string; evidenceIds: ReadonlySet<string> },
) {
  const current = await currentImageSelections(client, removal.batchId)
  for (const selection of current) {
    const kept = selection.images.filter((image) => !removal.evidenceIds.has(image.evidenceId))
    if (kept.length === selection.images.length) {
      continue
    }
    const partImage = kept.filter((image) => image.role === 'part_image')
    const stockImages = kept.filter((image) => image.role === 'stock_image')
    // Remaining stock images keep their order and close up from position 1.
    const images: SelectedImage[] = [
      ...partImage.map((image) => ({
        role: image.role,
        position: 0,
        derivationId: image.derivationId,
      })),
      ...stockImages.map((image, index) => ({
        role: image.role,
        position: index + 1,
        derivationId: image.derivationId,
      })),
    ]
    await writeImageSelection(client, binding, {
      batchId: removal.batchId,
      revision: removal.revision,
      lotId: selection.lotId,
      images,
    })
  }
}
