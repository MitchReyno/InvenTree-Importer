import type { Pool, PoolClient } from 'pg'
import {
  validate,
  type ProcessingImageCropDto,
  type ProcessingImagesProposalDto,
  type ProcessingImagesReviewDto,
  type RetainedSessionProposalDto,
} from '@invimport/contracts'
import { transaction } from '#/db/database.ts'
import { versionRemovedSql } from '#/media/removal.ts'
import { imageSelections } from '#/media/image-selections.ts'
import type { ProcessingConfig } from './attempts.ts'
import { fail, unseal } from './model.ts'
import { proposalCurrentnessFacts } from './read.ts'

type ImagesProposalValue = Extract<RetainedSessionProposalDto, { schema_version: 'images/1' }>

interface ImagesProposalRow {
  id: string
  job_id: string
  value_bytes: Buffer
  value_digest: Buffer
  created_at: Date
}

interface CropRow {
  proposal_id: string
  image_index: number
  render_state: 'queued' | 'ready' | 'failed' | null
  removed: boolean
  document: boolean
  evidence_id: string
  label: string
}

/** The batch, if it is in this API's actor, target and context scope; refused otherwise. */
async function requireScopedBatch(client: PoolClient, config: ProcessingConfig, batchId: string) {
  const rows = await client.query(
    `SELECT 1 FROM public.capture_batch
      WHERE id=$1 AND actor_id=$2 AND target_id=$3 AND target_context_id=$4`,
    [batchId, config.actorId, config.targetId, config.targetContextId],
  )
  if (!rows.rowCount) {
    fail('not_found', 404)
  }
}

/** The batch's media revision; a batch with no media yet is at its first. */
async function mediaRevision(client: PoolClient, batchId: string) {
  const rows = await client.query<{ revision: string }>(
    'SELECT revision::text FROM public.media_batch WHERE batch_id=$1',
    [batchId],
  )
  return rows.rows[0]?.revision ?? '1'
}

/**
 * Every `images/1` the batch's Images sessions published, each lot's job newest first: by its
 * attempt, then by the attempt's outbox sequence, which publication assigns in order.
 */
async function imagesProposalRows(client: PoolClient, batchId: string) {
  const rows = await client.query<ImagesProposalRow>(
    `SELECT p.id, j.id AS job_id, p.value_bytes, p.value_digest, o.created_at
       FROM public.processing_proposal p
       JOIN public.processing_attempt a ON a.id=p.attempt_id
       JOIN public.processing_job j ON j.id=a.job_id
       JOIN public.agent_session_outbox o
         ON o.session_id=p.attempt_id AND o.kind='proposal' AND o.payload->>'proposal_id'=p.id::text
      WHERE j.batch_id=$1 AND j.stage='images'
        AND EXISTS (SELECT 1 FROM public.processing_proposal_image i WHERE i.proposal_id=p.id)
      ORDER BY j.id, a.number DESC, o.seq DESC`,
    [batchId],
  )
  return rows.rows
}

/** How each stored crop's rendering stands, by proposal and then by crop index. */
async function cropStates(client: PoolClient, batchId: string) {
  const rows = await client.query<CropRow>(
    `SELECT i.proposal_id, i.image_index, r.state AS render_state,
       ${versionRemovedSql('v')} AS removed, v.media_type='application/pdf' AS document,
       e.id AS evidence_id, e.label
       FROM public.processing_proposal_image i
       JOIN public.media_version v ON v.batch_id=i.batch_id AND v.id=i.version_id
       JOIN public.media_evidence e ON e.id=v.evidence_id
       LEFT JOIN public.processing_figure_render r
         ON r.purpose='view' AND r.recipe_digest=i.recipe_digest
      WHERE i.batch_id=$1`,
    [batchId],
  )
  const states = new Map<string, Map<number, CropRow>>()
  for (const row of rows.rows) {
    const crops = states.get(row.proposal_id) ?? new Map<number, CropRow>()
    crops.set(row.image_index, row)
    states.set(row.proposal_id, crops)
  }
  return states
}

function cropState(row: CropRow): ProcessingImageCropDto['state'] {
  if (row.removed) {
    return 'removed'
  }
  if (row.render_state === 'queued') {
    return 'preparing'
  }
  if (row.render_state === 'ready') {
    return 'ready'
  }
  // A render whose request is gone keeps no recipe to render from, so it reads as failed.
  return 'failed'
}

function decodedImagesProposal(row: ImagesProposalRow): ImagesProposalValue {
  const value = unseal(row.value_bytes, row.value_digest)
  validate('RetainedSessionProposal', value)
  const proposal = value as RetainedSessionProposalDto
  if (proposal.schema_version !== 'images/1') {
    fail('retained_proposal_binding_invalid')
  }
  return proposal as ImagesProposalValue
}

function reviewedProposal(
  row: ImagesProposalRow,
  crops: Map<number, CropRow>,
  stale: boolean,
): ProcessingImagesProposalDto {
  const proposal = decodedImagesProposal(row)
  return {
    proposal_id: row.id,
    job_id: row.job_id,
    lot_id: proposal.subject_id,
    summary: proposal.summary,
    created_at: row.created_at.toISOString(),
    stale,
    crops: proposal.images.map((image, index) => {
      const crop = crops.get(index + 1) ?? fail('retained_proposal_binding_invalid')
      return {
        index: index + 1,
        role: image.role,
        recipe: image.recipe,
        flags: image.flags ?? [],
        state: cropState(crop),
        evidence_id: crop.evidence_id,
        evidence_label: crop.label,
        document: crop.document,
      }
    }),
  }
}

/**
 * The Images step's review: each `images/1` with its crops and how their renderings stand, and
 * each lot's confirmed images, read together in one snapshot.
 */
export async function readImagesReview(
  pool: Pool,
  config: ProcessingConfig,
  batchId: string,
): Promise<ProcessingImagesReviewDto> {
  return transaction(pool, async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    await requireScopedBatch(client, config, batchId)
    const rows = await imagesProposalRows(client, batchId)
    const crops = await cropStates(client, batchId)
    const facts = await proposalCurrentnessFacts(
      client,
      batchId,
      rows.map((row) => row.id),
    )
    const proposals = rows.map((row) =>
      reviewedProposal(row, crops.get(row.id) ?? new Map(), Boolean(facts.get(row.id)?.stale)),
    )
    const review = {
      media_revision: await mediaRevision(client, batchId),
      proposals,
      selections: await imageSelections(client, batchId),
    }
    validate('ProcessingImagesReview', review)
    return review
  })
}
