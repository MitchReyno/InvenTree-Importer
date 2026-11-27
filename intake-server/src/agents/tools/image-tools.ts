import type { PoolClient } from 'pg'
import type { MediaLitViewRecipeDto, ValidationIssue } from '@invimport/contracts'
import { DECODER_LABEL_MAX_CHARACTERS, viewLayout } from '@invimport/contracts/media'
import type {
  GridInput,
  GridResult,
  LogoMatchInput,
  LogoMatchResult,
  PreviewInput,
  PreviewResult,
} from '@invimport/media-decoder/protocol'
import { gridIsolated, logoMatchIsolated, previewIsolated } from '#/media/decoder-runner.ts'
import { versionRemovedSql } from '#/media/removal.ts'
import { ToolRefusal } from './refusal.ts'

/**
 * The decoder operations behind the image tools. The worker runs them in the pinned decoder
 * image, through the dispatcher when one is configured; tests may supply their own.
 */
export interface SessionImageOperations {
  grid: (input: GridInput) => Promise<GridResult>
  preview: (input: PreviewInput) => Promise<PreviewResult>
  logo: (input: LogoMatchInput) => Promise<LogoMatchResult>
}

/**
 * An image tool waits at most this long for a busy dispatcher, well inside a provider's tool
 * timeout; the agent is told to try again rather than kept waiting behind photo decodes.
 */
export const IMAGE_TOOL_BUSY_WAIT_MS = 20_000

export function isolatedImageOperations(image: string): SessionImageOperations {
  const dispatch = { busyWaitMs: IMAGE_TOOL_BUSY_WAIT_MS }
  return {
    grid: (input) => gridIsolated(image, input, dispatch),
    preview: (input) => previewIsolated(image, input, dispatch),
    logo: (input) => logoMatchIsolated(image, input, dispatch),
  }
}

/** A version a session may be given: pinned in its input or sent to it as a notice. */
export interface DeliverableVersion {
  evidence_id: string
  version_id: string
}

/** One retained page preview an image tool renders from, with the version it was decoded from. */
export interface ToolPage {
  evidenceId: string
  versionId: string
  kind: 'original' | 'derived'
  /** The version's own blob digest, which a recipe names as its source. */
  versionDigest: string
  page: number
  width: number
  height: number
  /** The page preview PNG's blob digest and size in bytes. */
  previewDigest: string
  previewBytes: number
}

interface ToolPageRow {
  evidence_id: string
  kind: 'original' | 'derived'
  version_digest: string
  removed: boolean
  width: number | null
  height: number | null
  preview_digest: string | null
  preview_bytes: string | null
}

async function pageRow(client: PoolClient, batchId: string, versionId: string, page: number) {
  const rows = await client.query<ToolPageRow>(
    `SELECT v.evidence_id, v.kind, encode(v.blob_digest,'hex') AS version_digest,
       ${versionRemovedSql('v')} AS removed,
       p.width, p.height, encode(p.blob_digest,'hex') AS preview_digest,
       b.byte_size::text AS preview_bytes
     FROM public.media_version v
     LEFT JOIN public.media_preview p ON p.version_id=v.id AND p.page=$3
     LEFT JOIN public.media_blob b ON b.digest=p.blob_digest
     WHERE v.batch_id=$1 AND v.id=$2`,
    [batchId, versionId, page],
  )
  return rows.rows[0]
}

type DecodedPageRow = ToolPageRow & {
  width: number
  height: number
  preview_digest: string
  preview_bytes: string
}

/** Whether the version has a decoded preview of the page. */
function decodedPage(row: ToolPageRow): row is DecodedPageRow {
  return (
    row.width !== null &&
    row.height !== null &&
    row.preview_digest !== null &&
    row.preview_bytes !== null
  )
}

function pageFrom(row: DecodedPageRow, versionId: string, page: number): ToolPage {
  return {
    evidenceId: row.evidence_id,
    versionId,
    kind: row.kind,
    versionDigest: row.version_digest,
    page,
    width: row.width,
    height: row.height,
    previewDigest: row.preview_digest,
    previewBytes: Number(row.preview_bytes),
  }
}

/**
 * The page an `inspect_region` or `match_logo` call names: a present original of the evidence
 * that was delivered to this session, and a decoded page of it. Without a version, the evidence's
 * delivered original is used; a named derived crop is refused, since these tools read originals.
 */
export async function namedToolPage(
  client: PoolClient,
  batchId: string,
  deliverable: readonly DeliverableVersion[],
  request: { evidence_id: string; version_id?: string; page?: number },
): Promise<ToolPage> {
  const candidates = deliverable.filter(
    (item) =>
      item.evidence_id === request.evidence_id &&
      (request.version_id === undefined || item.version_id === request.version_id),
  )
  const page = request.page ?? 1
  for (const candidate of candidates) {
    const row = await pageRow(client, batchId, candidate.version_id, page)
    if (!row || row.evidence_id !== request.evidence_id) {
      continue
    }
    if (row.kind !== 'original') {
      if (request.version_id !== undefined) {
        throw new ToolRefusal(
          'validation_failed',
          'Name the photo’s original version; these tools read originals, not derived crops.',
        )
      }
      continue
    }
    if (row.removed) {
      throw new ToolRefusal('media_evidence_removed', 'That evidence was deleted by the operator.')
    }
    if (!decodedPage(row)) {
      throw new ToolRefusal('validation_failed', 'That page has no preview yet.')
    }
    return pageFrom(row, candidate.version_id, page)
  }
  throw new ToolRefusal('source_not_delivered', 'That evidence was not delivered to this session.')
}

/**
 * The decoder measures a label in UTF-16 units, where a character outside the basic plane takes
 * two, so a label is refused here rather than failing inside the decoder.
 */
export function requireDecoderLabel(label: string, path: string) {
  if (label.length > DECODER_LABEL_MAX_CHARACTERS) {
    throw new ToolRefusal(
      'validation_failed',
      `A label may be at most ${DECODER_LABEL_MAX_CHARACTERS} characters, counting an emoji as two.`,
      [{ path, rule: 'maxLength', reason: 'The label is too long for the decoder.' }],
    )
  }
}

/** A region in page-preview pixels must lie within its page. */
export function requireRegionInPage(
  region: { x: number; y: number; width: number; height: number },
  page: ToolPage,
  path: string,
) {
  if (region.x + region.width > page.width || region.y + region.height > page.height) {
    throw new ToolRefusal(
      'validation_failed',
      `The region must lie within the page preview, ${page.width} × ${page.height} pixels.`,
      [{ path, rule: 'maximum', reason: 'The region is outside the page preview.' }],
    )
  }
}

function recipeIssue(path: string, rule: string, reason: string): ValidationIssue {
  return { path, rule, reason }
}

/** A recipe's page: a present original delivered to this session, decoded at that page. */
async function recipeSourcePage(
  client: PoolClient,
  batchId: string,
  delivered: ReadonlySet<string>,
  recipe: MediaLitViewRecipeDto,
  path: string,
): Promise<ToolPage> {
  const notInLot = () =>
    new ToolRefusal(
      'source_not_delivered',
      'A recipe names a photo that is not in this session’s lot.',
      [recipeIssue(`${path}/source_version_id`, 'delivered', 'Not one of this lot’s photos.')],
    )

  if (!delivered.has(recipe.source_version_id)) {
    throw notInLot()
  }
  const row = await pageRow(client, batchId, recipe.source_version_id, recipe.page)
  if (!row) {
    throw notInLot()
  }
  if (row.removed) {
    throw new ToolRefusal('media_evidence_removed', 'A recipe names a deleted photo.', [
      recipeIssue(`${path}/source_version_id`, 'removed', 'The operator deleted this photo.'),
    ])
  }
  if (row.kind !== 'original') {
    throw new ToolRefusal(
      'validation_failed',
      'A recipe must crop an original photo, not a derived crop.',
      [recipeIssue(`${path}/source_version_id`, 'original', 'Name the original version.')],
    )
  }
  if (!decodedPage(row)) {
    throw new ToolRefusal('validation_failed', 'A recipe names a page with no preview.', [
      recipeIssue(`${path}/page`, 'page', 'That page has no preview.'),
    ])
  }
  return pageFrom(row, recipe.source_version_id, recipe.page)
}

/** Every recipe must state its page's source exactly and fit it, whichever recipe found the page. */
function requireRecipeFitsPage(
  recipe: MediaLitViewRecipeDto,
  page: ToolPage,
  path: string,
  index: number,
) {
  if (page.versionDigest !== recipe.source_digest) {
    throw new ToolRefusal(
      'validation_failed',
      'A recipe’s source_digest must be its version’s digest.',
      [recipeIssue(`${path}/source_digest`, 'digest', 'Copy the version’s sha256.')],
    )
  }
  if (recipe.page_width !== page.width || recipe.page_height !== page.height) {
    throw new ToolRefusal(
      'validation_failed',
      `A recipe’s page size must be the page preview’s, ${page.width} × ${page.height}.`,
      [recipeIssue(`${path}/page_width`, 'page_size', 'Use the page preview’s size.')],
    )
  }
  try {
    viewLayout(recipe, 'full')
  } catch {
    throw new ToolRefusal(
      'validation_failed',
      `Crop ${index + 1}: its region doesn’t fit its page once straightened.`,
      [recipeIssue(`${path}/view/region`, 'maximum', 'The region is outside the page.')],
    )
  }
}

/**
 * The pages a set of recipe `/2` crops renders from. Each recipe must name a present original
 * delivered to this session, with the original's digest and a decoded page of the size it gives,
 * and a region that fits that page. `path` names each recipe for the agent's correction.
 * Returns the distinct pages, in first-use order, and each recipe's index into them.
 */
export async function recipePages(
  client: PoolClient,
  batchId: string,
  deliverable: readonly DeliverableVersion[],
  recipes: readonly { recipe: MediaLitViewRecipeDto; path: string }[],
): Promise<{ pages: ToolPage[]; pageOf: number[] }> {
  const pages: ToolPage[] = []
  const pageOf: number[] = []
  const delivered = new Set(deliverable.map((item) => item.version_id))
  for (const [index, { recipe, path }] of recipes.entries()) {
    let known = pages.findIndex(
      (page) => page.versionId === recipe.source_version_id && page.page === recipe.page,
    )
    if (known < 0) {
      pages.push(await recipeSourcePage(client, batchId, delivered, recipe, path))
      known = pages.length - 1
    }
    requireRecipeFitsPage(recipe, pages[known], path, index)
    pageOf.push(known)
  }
  return { pages, pageOf }
}

/**
 * The evidence in a lot's current scope: items linked to it now, and items holding one of its
 * active observations. A photo the lot was once given but has since lost is outside it.
 */
export async function lotEvidenceIds(client: PoolClient, batchId: string, lotId: string) {
  const rows = await client.query<{ evidence_id: string }>(
    `SELECT l.evidence_id FROM (
         SELECT DISTINCT ON (evidence_id) evidence_id, linked
           FROM public.media_subject_link
          WHERE batch_id=$1 AND subject_id=$2
          ORDER BY evidence_id, revision DESC
       ) l
      WHERE l.linked
     UNION
     SELECT v.evidence_id
       FROM public.capture_lot_evidence_observation lo
       JOIN public.capture_evidence_observation o ON o.id=lo.evidence_observation_id
       JOIN public.media_version v ON v.id=o.evidence_version_id
      WHERE lo.batch_id=$1 AND lo.lot_id=$2 AND lo.status='active' AND o.status='active'`,
    [batchId, lotId],
  )
  return new Set(rows.rows.map((row) => row.evidence_id))
}
