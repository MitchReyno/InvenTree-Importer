import type { PoolClient } from 'pg'
import {
  validate,
  type CaptureSnapshotDto,
  type OperatorIssueDto,
  type OperatorReviewDto,
} from '@invimport/contracts'
import { canonicalRecord } from '@invimport/contracts/json'
import { captureInTransaction, fail } from '../capture/repository.ts'
import {
  latestInstructions,
  loadReviewContext,
  type CaptureReviewContext,
} from '../capture/review-context.ts'
import { stockSourceHistory } from '../execution/source.ts'
import type { ManualConfig } from '../review/authority.ts'
import type { ManualMaterial } from '../review/model.ts'
import { batchDependencies, lotReviewState, retainedReviews } from './review-state.ts'

const MAX_PROJECTION_BYTES = 245760

export interface SourceHistory {
  approvedContributionKeys: ReadonlySet<string>
  /** An active or unsettled original run blocks further approval of this source. */
  blockingRunId: string | null
  /** Contribution key → the original run that holds it. */
  runByContribution: ReadonlyMap<string, string>
}

export async function sourceHistory(
  client: PoolClient,
  config: ManualConfig,
  capture: { sourceId: string; originalSourceKey: string },
  contributionKeys: string[],
): Promise<SourceHistory> {
  const history = await stockSourceHistory(
    client,
    {
      targetId: config.targetId,
      sourceId: capture.sourceId,
      originalSourceKey: capture.originalSourceKey,
    },
    contributionKeys,
  )
  const blocking = history.runs.find(
    (run) => run.state === 'queued' || run.state === 'recovery_required',
  )
  const runByContribution = new Map<string, string>()
  for (const contribution of history.contributions) {
    runByContribution.set(contribution.contribution_key, contribution.run_id)
  }
  return {
    approvedContributionKeys: new Set(runByContribution.keys()),
    blockingRunId: history.activeRunId ?? blocking?.runId ?? null,
    runByContribution,
  }
}

function blockingIssues(
  material: ManualMaterial,
  lot: CaptureSnapshotDto['lots'][number],
  history: SourceHistory,
): OperatorIssueDto[] {
  const issues: OperatorIssueDto[] = material.issues.map((problem) => ({
    code: problem.code,
    severity: 'blocking',
    message: problem.message,
    subject_id: problem.lot_id,
    lot_id: problem.lot_id,
    run_id: problem.run_id,
    dependency_digest: null,
    disposition: null,
  }))
  const approvedRun = history.runByContribution.get(lot.contribution_key)
  if (approvedRun) {
    issues.push({
      code: 'original_contribution_already_approved',
      severity: 'blocking',
      message: 'This contribution already has an approval; inspect its original run.',
      subject_id: lot.id,
      lot_id: lot.id,
      run_id: approvedRun,
      dependency_digest: null,
      disposition: null,
    })
  } else if (history.blockingRunId) {
    issues.push({
      code: 'source_history_unsettled',
      severity: 'blocking',
      message: 'Inspect the earlier original run before approving more stock.',
      subject_id: null,
      lot_id: lot.id,
      run_id: history.blockingRunId,
      dependency_digest: null,
      disposition: null,
    })
  }
  return issues
}

function warningIssues(material: ManualMaterial): OperatorIssueDto[] {
  return material.warnings.map((warning) => ({
    code: warning.code,
    severity: 'warning',
    message: warning.message,
    subject_id: warning.subjectId,
    lot_id: warning.lotId,
    run_id: null,
    dependency_digest: warning.factDigest,
    disposition: warning.disposition && {
      id: warning.disposition.id,
      reason: warning.disposition.reason,
      actor_id: warning.disposition.actorId,
      created_at: warning.disposition.createdAt,
    },
  }))
}

function retiredLots(snapshot: CaptureSnapshotDto, context: CaptureReviewContext) {
  return context.retired.map((record) => {
    const lot = snapshot.lots.find((value) => value.id === record.lotId)
    if (!lot) {
      throw new Error('capture_retired_lot_missing')
    }
    return {
      lot_id: record.lotId,
      label: lot.label,
      action: record.action,
      retired_revision: record.revision,
      successor_lot_ids: record.successorLotIds,
    }
  })
}

/** Repeatable-read operator projection; callers own the transaction. */
export async function operatorReview(
  client: PoolClient,
  config: ManualConfig,
  batchId: string,
): Promise<OperatorReviewDto> {
  const capture = await captureInTransaction(client, config, batchId)
  const snapshot = capture.snapshot
  const context = await loadReviewContext(client, batchId)
  const dependencies = await batchDependencies(client, config, snapshot, context)
  const reviews = await retainedReviews(client, batchId)
  const activeLots = snapshot.lots.filter((lot) => !context.retiredLotIds.has(lot.id))
  const history = await sourceHistory(
    client,
    config,
    capture,
    activeLots.map((lot) => lot.contribution_key),
  )
  const lots: OperatorReviewDto['lots'] = activeLots.map((lot) => {
    const { material } = dependencies.lots.get(lot.id)!
    const shared = activeLots
      .filter((other) => other.id !== lot.id && lot.part_subject_id !== null)
      .filter((other) => other.part_subject_id === lot.part_subject_id)
      .map((other) => other.id)
    return {
      lot_id: lot.id,
      label: lot.label,
      part_subject_id: lot.part_subject_id,
      shared_lot_ids: shared,
      review_state: lotReviewState(reviews, material),
      approved: history.approvedContributionKeys.has(lot.contribution_key),
      issues: [...blockingIssues(material, lot, history), ...warningIssues(material)],
      predecessor_lot_ids: context.predecessors.get(lot.id) ?? [],
      ...(lot.excluded ? { excluded: lot.excluded } : {}),
    }
  })
  const instructions = await latestInstructions(client, batchId)
  const result: OperatorReviewDto = {
    batch_id: batchId,
    revision: snapshot.revision,
    lots,
    retired_lots: retiredLots(snapshot, context),
    instructions: instructions.map((value) => ({
      group_id: value.groupId,
      version: value.version,
      text: value.text,
      actor_id: value.actorId,
      created_at: value.createdAt,
    })),
    cursor: snapshot.cursor,
  }
  validate('OperatorReview', result)
  if (Buffer.byteLength(canonicalRecord(result)) > MAX_PROJECTION_BYTES) {
    fail('operator_review_capacity', 409)
  }
  return result
}
