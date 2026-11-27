import type { PoolClient } from 'pg'
import type { MediaLitViewRecipeDto, ValidationIssue } from '@invimport/contracts'
import { viewLayout } from '@invimport/contracts/media'
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
  /** The page preview PNG's blob digest. */
  previewDigest: string
}

interface ToolPageRow {
  evidence_id: string
  kind: 'original' | 'derived'
  version_digest: string
  removed: boolean
  width: number | null
  height: number | null
  preview_digest: string | null
}

async function pageRow(client: PoolClient, batchId: string, versionId: string, page: number) {
  const rows = await client.query<ToolPageRow>(
    `SELECT v.evidence_id, v.kind, encode(v.blob_digest,'hex') AS version_digest,
       ${versionRemovedSql('v')} AS removed,
       p.width, p.height, encode(p.blob_digest,'hex') AS preview_digest
     FROM public.media_version v
     LEFT JOIN public.media_preview p ON p.version_id=v.id AND p.page=$3
     WHERE v.batch_id=$1 AND v.id=$2`,
    [batchId, versionId, page],
  )
  return rows.rows[0]
}

type DecodedPageRow = ToolPageRow & { width: number; height: number; preview_digest: string }

/** Whether the version has a decoded preview of the page. */
function decodedPage(row: ToolPageRow): row is DecodedPageRow {
  return row.width !== null && row.height !== null && row.preview_digest !== null
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
  }
}

/**
 * The page an `inspect_region` or `match_logo` call names: a present version of the evidence
 * that was delivered to this session, and a decoded page of it. Without a version, the first
 * deliverable version of the evidence is used, as `fetch_evidence` does.
 */
export async function namedToolPage(
  client: PoolClient,
  batchId: string,
  deliverable: readonly DeliverableVersion[],
  request: { evidence_id: string; version_id?: string; page?: number },
): Promise<ToolPage> {
  const version = deliverable.find(
    (item) =>
      item.evidence_id === request.evidence_id &&
      (request.version_id === undefined || item.version_id === request.version_id),
  )
  if (!version) {
    throw new ToolRefusal(
      'source_not_delivered',
      'That evidence was not delivered to this session.',
    )
  }
  const page = request.page ?? 1
  const row = await pageRow(client, batchId, version.version_id, page)
  if (!row || row.evidence_id !== request.evidence_id) {
    throw new ToolRefusal('source_not_delivered', 'That evidence version is outside this session.')
  }
  if (row.removed) {
    throw new ToolRefusal('media_evidence_removed', 'That evidence was deleted by the operator.')
  }
  if (!decodedPage(row)) {
    throw new ToolRefusal('validation_failed', 'That page has no preview yet.')
  }
  return pageFrom(row, version.version_id, page)
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
  for (const { recipe, path } of recipes) {
    const known = pages.findIndex(
      (page) => page.versionId === recipe.source_version_id && page.page === recipe.page,
    )
    if (known >= 0) {
      pageOf.push(known)
      continue
    }
    if (!delivered.has(recipe.source_version_id)) {
      throw new ToolRefusal(
        'source_not_delivered',
        'A recipe names a photo that is not in this session’s lot.',
        [recipeIssue(`${path}/source_version_id`, 'delivered', 'Not one of this lot’s photos.')],
      )
    }
    const row = await pageRow(client, batchId, recipe.source_version_id, recipe.page)
    if (!row) {
      throw new ToolRefusal(
        'source_not_delivered',
        'A recipe names a photo that is not in this session’s lot.',
        [recipeIssue(`${path}/source_version_id`, 'delivered', 'Not one of this lot’s photos.')],
      )
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
    if (row.version_digest !== recipe.source_digest) {
      throw new ToolRefusal(
        'validation_failed',
        'A recipe’s source_digest must be its version’s digest.',
        [recipeIssue(`${path}/source_digest`, 'digest', 'Copy the version’s sha256.')],
      )
    }
    if (!decodedPage(row)) {
      throw new ToolRefusal('validation_failed', 'A recipe names a page with no preview.', [
        recipeIssue(`${path}/page`, 'page', 'That page has no preview.'),
      ])
    }
    const page = pageFrom(row, recipe.source_version_id, recipe.page)
    if (recipe.page_width !== page.width || recipe.page_height !== page.height) {
      throw new ToolRefusal(
        'validation_failed',
        `A recipe’s page size must be the page preview’s, ${page.width} × ${page.height}.`,
        [recipeIssue(`${path}/page_width`, 'page_size', 'Use the page preview’s size.')],
      )
    }
    pages.push(page)
    pageOf.push(pages.length - 1)
  }
  for (const [index, { recipe, path }] of recipes.entries()) {
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
  return { pages, pageOf }
}
