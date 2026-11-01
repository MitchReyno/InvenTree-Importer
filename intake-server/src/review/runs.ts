import type { PoolClient } from 'pg'
import {
  validate,
  Id,
  Digest,
  type ManualPreparationResultDto,
  type ManualRunDto,
} from '@invimport/contracts'
import { canonical, strictJson } from '@invimport/contracts/json'
import { verifyBytes } from '../db/authority.ts'
import { fail } from '../capture/repository.ts'
import { decodePlan } from '../execution/plan.ts'
import { snapshot } from '../execution/authority.ts'
import type { ManualConfig } from './authority.ts'
import type { ReviewBinding } from './authority.ts'

function isReviewBinding(value: unknown): value is ReviewBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const record = value as Record<string, unknown>
  return (
    Object.keys(record).sort().join(',') === 'digest,reviewId,subjectId' &&
    typeof record.digest === 'string' &&
    new RegExp(Digest.pattern!).test(record.digest) &&
    typeof record.reviewId === 'string' &&
    new RegExp(Id.pattern!).test(record.reviewId) &&
    typeof record.subjectId === 'string' &&
    new RegExp(Id.pattern!).test(record.subjectId)
  )
}

export async function retainedPreparation(
  client: PoolClient,
  config: ManualConfig,
  preparationId: string,
) {
  const result = await client.query(
    'SELECT * FROM manual_preparation WHERE id=$1 AND actor_id=$2',
    [preparationId, config.actorId],
  )
  const row = result.rows[0]
  if (!row) {
    fail('not_found', 404)
  }
  const plan = decodePlan(row.plan_bytes, row.plan_digest)
  if (plan.targetId !== config.targetId || plan.contextId !== config.targetContextId) {
    fail('not_found', 404)
  }
  verifyBytes(row.review_bytes, row.review_digest)
  verifyBytes(row.dependency_bytes, row.dependency_digest)
  const outcomeResult = await client.query(
    'SELECT command_id,response_bytes,response_digest FROM manual_prepare_outcome WHERE command_id=$1',
    [row.prepare_command_id],
  )
  const outcome = outcomeResult.rows[0]
  if (!outcome || outcome.command_id !== row.prepare_command_id) {
    fail('retained_preparation_corrupt', 409)
  }
  verifyBytes(outcome.response_bytes, outcome.response_digest)
  const sealed: unknown = strictJson(outcome.response_bytes.toString('utf8'))
  validate('ManualPreparationResult', sealed)
  const response = sealed as ManualPreparationResultDto
  if (
    response.status !== 'prepared' ||
    canonical(response) !== outcome.response_bytes.toString('utf8') ||
    canonical(response.preparation) !== row.preview_bytes.toString('utf8')
  ) {
    fail('retained_preparation_corrupt', 409)
  }
  const checked = response.preparation
  if (
    checked.id !== row.id ||
    checked.batch_id !== row.batch_id ||
    checked.plan_sha256 !== row.plan_digest.toString('hex') ||
    checked.review_fingerprint !== row.review_digest.toString('hex') ||
    checked.target_revision !== row.target_revision ||
    checked.effects.length !== plan.operations.length
  ) {
    fail('retained_preparation_corrupt', 409)
  }
  for (const effect of checked.effects) {
    const operation = plan.operations.find((value) => value.operationKey === effect.lot_id)
    if (
      !operation ||
      operation.contributionKey !== effect.contribution_key ||
      operation.quantity !== effect.quantity ||
      operation.part !== effect.part_id ||
      operation.location !== effect.location_id ||
      operation.barcode !== effect.barcode
    ) {
      fail('retained_preparation_corrupt', 409)
    }
  }
  const operationIds = plan.operations.map((value) => value.operationKey).sort()
  if (
    canonical([...checked.selected_lot_ids].sort()) !== canonical(operationIds) ||
    canonical(checked.effects.map((value) => value.lot_id).sort()) !== canonical(operationIds)
  ) {
    fail('retained_preparation_corrupt', 409)
  }
  const parsedReviews = strictJson(row.review_bytes.toString('utf8'))
  if (
    !Array.isArray(parsedReviews) ||
    parsedReviews.length < 1 ||
    parsedReviews.length > 20 ||
    !parsedReviews.every(isReviewBinding) ||
    new Set(parsedReviews.map((value) => value.subjectId)).size !== parsedReviews.length
  ) {
    fail('retained_preparation_corrupt', 409)
  }
  const reviews = parsedReviews
  const indexedReviews = await client.query(
    `SELECT p.subject_id,p.review_id,r.actor_id,r.dependency_bytes,r.dependency_digest
     FROM manual_preparation_review p JOIN manual_review r
       ON r.batch_id=p.batch_id AND r.subject_id=p.subject_id AND r.id=p.review_id
     WHERE p.batch_id=$1 AND p.preparation_id=$2`,
    [row.batch_id, row.id],
  )
  if (indexedReviews.rows.length !== reviews.length) {
    fail('retained_preparation_corrupt', 409)
  }
  for (const binding of reviews) {
    const indexed = indexedReviews.rows.find(
      (value) => value.subject_id === binding.subjectId && value.review_id === binding.reviewId,
    )
    if (!indexed || indexed.actor_id !== config.actorId) {
      fail('retained_preparation_corrupt', 409)
    }
    verifyBytes(indexed.dependency_bytes, indexed.dependency_digest)
    if (indexed.dependency_digest.toString('hex') !== binding.digest) {
      fail('retained_preparation_corrupt', 409)
    }
  }
  const indexedLots = await client.query(
    'SELECT * FROM manual_preparation_lot WHERE batch_id=$1 AND preparation_id=$2',
    [row.batch_id, row.id],
  )
  if (
    indexedLots.rows.length !== plan.operations.length ||
    indexedLots.rows.some(
      (value) =>
        value.source_id !== plan.sourceId ||
        !plan.operations.some(
          (operation) =>
            operation.operationKey === value.lot_id &&
            operation.contributionKey === value.contribution_key,
        ) ||
        !reviews.some(
          (binding) => binding.subjectId === value.lot_id && binding.reviewId === value.review_id,
        ),
    )
  ) {
    fail('retained_preparation_corrupt', 409)
  }
  const commandResult = await client.query(
    'SELECT * FROM manual_prepare_command WHERE id=$1 AND batch_id=$2 AND actor_id=$3',
    [row.prepare_command_id, row.batch_id, config.actorId],
  )
  const command = commandResult.rows[0]
  if (
    !command ||
    command.deployment_id !== plan.deploymentId ||
    command.target_id !== plan.targetId ||
    command.context_id !== plan.contextId ||
    !command.dependency_bytes.equals(row.dependency_bytes) ||
    !command.review_bytes.equals(row.review_bytes)
  ) {
    fail('retained_preparation_corrupt', 409)
  }
  verifyBytes(command.dependency_bytes, command.dependency_digest)
  verifyBytes(command.review_bytes, command.review_digest)
  const expectedReads = new Map<
    string,
    { model: string; pk: string; outcome: string; label: string }
  >()
  for (const effect of checked.effects) {
    expectedReads.set(`part:${effect.part_id}`, {
      model: 'part',
      pk: effect.part_id,
      outcome: 'found',
      label: effect.part_label,
    })
    if (effect.location_id) {
      expectedReads.set(`location:${effect.location_id}`, {
        model: 'location',
        pk: effect.location_id,
        outcome: 'found',
        label: effect.location_label,
      })
    }
  }
  const reads = await client.query(
    `SELECT i.model,i.pk,r.outcome,r.receipt_bytes,r.receipt_digest
     FROM manual_read_intent i LEFT JOIN manual_read_result r ON r.intent_id=i.id
     WHERE i.batch_id=$1 AND i.prepare_command_id=$2`,
    [row.batch_id, row.prepare_command_id],
  )
  if (reads.rows.length !== expectedReads.size) {
    fail('retained_preparation_corrupt', 409)
  }
  for (const receipt of reads.rows) {
    const expected = expectedReads.get(`${receipt.model}:${receipt.pk}`)
    if (
      !expected ||
      receipt.outcome !== 'found' ||
      !receipt.receipt_bytes ||
      !receipt.receipt_digest
    ) {
      fail('retained_preparation_corrupt', 409)
    }
    verifyBytes(receipt.receipt_bytes, receipt.receipt_digest)
    if (receipt.receipt_bytes.toString('utf8') !== canonical(expected)) {
      fail('retained_preparation_corrupt', 409)
    }
  }
  return { row, plan, preview: checked }
}

export async function runIdentity(client: PoolClient, config: ManualConfig, runId: string) {
  const result = await client.query(
    `SELECT r.*,a.preparation_id,a.actor_id,a.round_number
     FROM manual_run r JOIN manual_approval a ON a.id=r.approval_id AND a.batch_id=r.batch_id
     WHERE r.id=$1 AND a.actor_id=$2`,
    [runId, config.actorId],
  )
  const row = result.rows[0]
  if (!row) {
    fail('not_found', 404)
  }
  const preparation = await retainedPreparation(client, config, row.preparation_id)
  return { row, preparation }
}

export async function manualRunSnapshot(
  client: PoolClient,
  config: ManualConfig,
  runId: string,
): Promise<ManualRunDto> {
  const { row, preparation } = await runIdentity(client, config, runId)
  const journal = await snapshot(client, runId)
  const dispatchResult = await client.query<{ state: ManualRunDto['dispatch_state'] }>(
    'SELECT state FROM manual_dispatch WHERE run_id=$1 ORDER BY sequence DESC LIMIT 1',
    [runId],
  )
  const dispatchState = dispatchResult.rows[0]?.state ?? 'not_requested'
  let state: ManualRunDto['state'] = journal.state
  if (journal.state !== 'recovery_required' && journal.state !== 'settled_complete') {
    if (dispatchState === 'running') {
      state = journal.cancellationRequested ? 'stopping' : 'running'
    } else if (dispatchState === 'queued') {
      state = 'queued'
    } else if (dispatchState === 'interrupted') {
      state = 'recovery_required'
    }
  }
  const operations = journal.operations.map((operation) => {
    const effect = preparation.preview.effects.find(
      (value) => value.lot_id === operation.operationKey,
    )
    if (!effect) {
      fail('retained_preparation_corrupt', 409)
    }
    return {
      operation_key: operation.operationKey,
      lot_id: effect.lot_id,
      lot_label: effect.lot_label,
      quantity: effect.quantity,
      certainty: operation.certainty,
      remote_pk: operation.remotePk,
      recovery_allowed: state === 'settled_incomplete' && operation.certainty === 'none',
    }
  })
  const certainties = new Set(operations.map((value) => value.certainty))
  const effectCertainty = certainties.size > 1 ? 'mixed' : (operations[0]?.certainty ?? 'none')
  const streamResult = await client.query<{ head: string }>(
    'SELECT head FROM ui_stream WHERE id=$1',
    [row.stream_id],
  )
  const result: ManualRunDto = {
    run_id: runId,
    batch_id: row.batch_id,
    approval_id: row.approval_id,
    preparation_id: row.preparation_id,
    round_number: row.round_number,
    revision: row.revision,
    state,
    effect_certainty: effectCertainty,
    confirmed_stock_ids: journal.confirmedStockIds,
    attributed_stock_ids: journal.attributedStockIds,
    cancellation_requested: journal.cancellationRequested,
    dispatch_state: dispatchState,
    operations,
    cursor: { stream_id: row.stream_id, sequence: streamResult.rows[0].head },
  }
  validate('ManualRun', result)
  return result
}
