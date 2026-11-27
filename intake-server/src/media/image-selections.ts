import type { PoolClient } from 'pg'
import {
  validate,
  type MediaLitViewRecipeDto,
  type MediaVersionDto,
  type ProcessingImageSelectionDto,
  type ProcessingImageSelectionItemDto,
} from '@invimport/contracts'
import { retainedDerivedRecipe } from './projection.ts'

export type ImageRole = 'part_image' | 'stock_image'
type DecodeState = MediaVersionDto['state']

/** One confirmed image of a lot's current selection, with the derivation that crops it. */
export interface CurrentImage {
  role: ImageRole
  position: number
  derivationId: string
  evidenceId: string
  recipeBytes: Buffer
  recipeDigest: Buffer
  /** Null while the derivation's decode command has no result. */
  state: DecodeState | null
}

/** A lot's latest selection row; one with no items has cleared the lot's images. */
export interface CurrentImageSelection {
  lotId: string
  revision: string
  images: CurrentImage[]
}

interface CurrentImageRow {
  lot_id: string
  revision: string
  role: ImageRole | null
  position: number | null
  derivation_id: string | null
  evidence_id: string | null
  recipe_bytes: Buffer | null
  recipe_digest: Buffer | null
  state: DecodeState | null
}

const CURRENT_IMAGE_SELECTIONS_SQL = `
  WITH latest AS (
    SELECT DISTINCT ON (s.subject_id) s.id, s.batch_id, s.subject_id, s.revision
    FROM public.media_image_selection s
    WHERE s.batch_id = $1
    ORDER BY s.subject_id, s.revision DESC
  )
  SELECT l.subject_id AS lot_id,
         l.revision::text AS revision,
         i.role,
         i.position,
         i.derivation_id,
         d.evidence_id,
         d.recipe_bytes,
         d.recipe_digest,
         r.state
  FROM latest l
  LEFT JOIN public.media_image_selection_item i
    ON i.batch_id = l.batch_id AND i.selection_id = l.id
  LEFT JOIN public.media_derivation d
    ON d.batch_id = i.batch_id AND d.id = i.derivation_id
  LEFT JOIN public.media_decode_command c
    ON c.derivation_id = d.id
  LEFT JOIN public.media_decode_result r
    ON r.command_id = c.id
  ORDER BY l.subject_id, i.position`

function currentImage(row: CurrentImageRow): CurrentImage {
  if (!row.role || row.position === null || !row.derivation_id) {
    throw new Error('image_selection_item_missing')
  }
  if (!row.evidence_id || !row.recipe_bytes || !row.recipe_digest) {
    throw new Error('image_selection_derivation_missing')
  }
  return {
    role: row.role,
    position: row.position,
    derivationId: row.derivation_id,
    evidenceId: row.evidence_id,
    recipeBytes: row.recipe_bytes,
    recipeDigest: row.recipe_digest,
    state: row.state,
  }
}

/** Every lot's latest selection row, ordered by lot id, its images by position. */
export async function currentImageSelections(
  client: PoolClient,
  batchId: string,
): Promise<CurrentImageSelection[]> {
  const result = await client.query<CurrentImageRow>(CURRENT_IMAGE_SELECTIONS_SQL, [batchId])
  const selections = new Map<string, CurrentImageSelection>()
  for (const row of result.rows) {
    let selection = selections.get(row.lot_id)
    if (!selection) {
      selection = { lotId: row.lot_id, revision: row.revision, images: [] }
      selections.set(row.lot_id, selection)
    }
    // A selection with no items is one row with no item columns.
    if (row.derivation_id !== null) {
      selection.images.push(currentImage(row))
    }
  }
  return [...selections.values()]
}

function selectedRecipe(image: CurrentImage): MediaLitViewRecipeDto {
  const recipe = retainedDerivedRecipe(image.recipeBytes, image.recipeDigest)
  if (recipe.version !== 'bench-intake-view/2') {
    throw new Error('image_selection_recipe_invalid')
  }
  return recipe
}

function selectionItem(image: CurrentImage): ProcessingImageSelectionItemDto {
  return {
    version_id: image.derivationId,
    recipe: selectedRecipe(image),
    state: image.state ?? 'queued',
  }
}

/**
 * The Images review's confirmed images: each lot's latest selection, ordered by lot id, including
 * one confirmed or cleared to none. A derived crop's version takes its derivation's id, so it is
 * named before it is decoded.
 */
export async function imageSelections(
  client: PoolClient,
  batchId: string,
): Promise<ProcessingImageSelectionDto[]> {
  const current = await currentImageSelections(client, batchId)
  const projected: ProcessingImageSelectionDto[] = []
  for (const selection of current) {
    const partImage = selection.images.find((image) => image.role === 'part_image')
    const stockImages = selection.images.filter((image) => image.role === 'stock_image')
    const dto: ProcessingImageSelectionDto = {
      lot_id: selection.lotId,
      revision: selection.revision,
      part_image: partImage ? selectionItem(partImage) : null,
      stock_images: stockImages.map(selectionItem),
    }
    validate('ProcessingImageSelection', dto)
    projected.push(dto)
  }
  return projected
}
