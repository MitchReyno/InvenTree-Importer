import type { PoolClient } from 'pg'
import type {
  MediaViewRecipeDto,
  ProcessingMediaSourceDto,
  QuestionFigureDto,
  SessionToolErrorDto,
  ValidationIssue,
} from '@invimport/contracts'
import { VIEW_MARK_UNITS } from '@invimport/contracts/media'
import { versionRemovedSql } from '#/media/removal.ts'

/** Why a figure can't be shown, naming the figure and field; the agent corrects it. */
export interface FigureRefusal {
  code: SessionToolErrorDto
  message: string
  issue: ValidationIssue
}

/** A validated figure with the view recipe the renderer and the read share. */
export interface ResolvedFigure {
  figure: QuestionFigureDto
  recipe: MediaViewRecipeDto
}

export interface FigureDelivery {
  /** The shared delivery predicate proposals use, by version. */
  delivered: (source: ProcessingMediaSourceDto) => boolean
  /** The pages of a version this session was given. */
  pages: (versionId: string) => ReadonlySet<number>
}

interface FigureSourceRow {
  id: string
  evidence_id: string
  sha256: string
  removed: boolean
  preview_width: number | null
  preview_height: number | null
}

function refusal(
  code: SessionToolErrorDto,
  index: number,
  field: string,
  message: string,
  rule: string,
): FigureRefusal {
  return {
    code,
    message: `Figure ${index + 1}: ${message}`,
    issue: { path: `/figures/${index}${field}`, rule, reason: message.slice(0, 160) },
  }
}

/** Each mark's box must lie within the view, since its fractions are of the rendered view. */
function markRefusal(figure: QuestionFigureDto, index: number): FigureRefusal | null {
  for (const [markIndex, mark] of (figure.marks ?? []).entries()) {
    if (mark.kind === 'label' || mark.kind === 'arrow') {
      continue
    }
    const box = mark.geometry
    if (box.x + box.width > VIEW_MARK_UNITS || box.y + box.height > VIEW_MARK_UNITS) {
      return refusal(
        'validation_failed',
        index,
        `/marks/${markIndex}/geometry`,
        `a mark must lie within the picture; x + width and y + height are at most ${VIEW_MARK_UNITS}.`,
        'maximum',
      )
    }
  }
  return null
}

async function figureSource(
  client: PoolClient,
  batchId: string,
  figure: QuestionFigureDto,
): Promise<FigureSourceRow | undefined> {
  const rows = await client.query<FigureSourceRow>(
    `SELECT v.id, v.evidence_id, encode(v.blob_digest,'hex') AS sha256,
       ${versionRemovedSql('v')} AS removed,
       p.width AS preview_width, p.height AS preview_height
     FROM public.media_version v
     LEFT JOIN public.media_preview p ON p.version_id=v.id AND p.page=$3
     WHERE v.batch_id=$1 AND v.id=$2`,
    [batchId, figure.source.version_id, figure.source.page],
  )
  return rows.rows[0]
}

/**
 * Checks every figure against what this session was given: a delivered, present version of the
 * named evidence, a page of it the session fetched, and a region within that page's preview.
 * Returns the first refusal, or each figure with its view recipe.
 */
export async function resolveFigures(
  client: PoolClient,
  batchId: string,
  figures: QuestionFigureDto[],
  delivery: FigureDelivery,
): Promise<{ refusal: FigureRefusal } | { figures: ResolvedFigure[] }> {
  const resolved: ResolvedFigure[] = []
  for (const [index, figure] of figures.entries()) {
    const row = await figureSource(client, batchId, figure)
    if (!row || row.evidence_id !== figure.source.evidence_id) {
      return {
        refusal: refusal(
          'source_not_delivered',
          index,
          '/source',
          'that evidence version is not in this batch.',
          'delivered',
        ),
      }
    }
    const source: ProcessingMediaSourceDto = {
      kind: 'media_version',
      evidence_id: row.evidence_id,
      version_id: row.id,
      sha256: row.sha256,
    }
    if (!delivery.delivered(source)) {
      return {
        refusal: refusal(
          'source_not_delivered',
          index,
          '/source/version_id',
          'that version was not delivered to this session. Fetch it with fetch_evidence first.',
          'delivered',
        ),
      }
    }
    if (row.removed) {
      return {
        refusal: refusal(
          'media_evidence_removed',
          index,
          '/source',
          'that photo was removed from Capture.',
          'removed',
        ),
      }
    }
    if (row.preview_width === null || row.preview_height === null) {
      return {
        refusal: refusal(
          'validation_failed',
          index,
          '/source/page',
          'that version has no such page.',
          'page',
        ),
      }
    }
    if (!delivery.pages(row.id).has(figure.source.page)) {
      return {
        refusal: refusal(
          'source_not_delivered',
          index,
          '/source/page',
          'that page was not delivered to this session. Fetch the page with fetch_evidence first.',
          'delivered',
        ),
      }
    }
    const region = figure.view.region
    if (
      region.x + region.width > row.preview_width ||
      region.y + region.height > row.preview_height
    ) {
      return {
        refusal: refusal(
          'validation_failed',
          index,
          '/view/region',
          `the region must lie within the page preview, ${row.preview_width} × ${row.preview_height} pixels.`,
          'maximum',
        ),
      }
    }
    const marks = markRefusal(figure, index)
    if (marks) {
      return { refusal: marks }
    }
    resolved.push({
      figure,
      recipe: {
        version: 'bench-intake-view/1',
        source_version_id: row.id,
        source_digest: row.sha256,
        page: figure.source.page,
        page_width: row.preview_width,
        page_height: row.preview_height,
        view: figure.view,
      },
    })
  }
  return { figures: resolved }
}
