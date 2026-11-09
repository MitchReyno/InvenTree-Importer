import type { Pool, PoolClient } from 'pg'
import {
  validate,
  type BulkEditDto,
  type BulkEditResultDto,
  type CaptureSnapshotDto,
  type InstructionEditDto,
  type IssueDispositionDto,
  type OperatorOutcomeDto,
  type OperatorReviewDto,
  type RestructureDto,
  type RestructureResultDto,
} from '@invimport/contracts'
import { transaction } from '../db/database.ts'
import { idempotent, type CommandScope } from '../db/authority.ts'
import { lockCaptureForOperatorCommand, type OperatorCommandScope } from '../capture/repository.ts'
import { fail } from '../capture/model.ts'
import { loadReviewContext } from '../capture/review-context.ts'
import {
  applyBulkEdit,
  applyRestructure,
  recordDisposition,
  recordInstruction,
  type StructuralOutcome,
} from '../capture/operator-commands.ts'
import type { ManualConfig } from '../review/authority.ts'
import { materializeWithMedia } from '../review/media-material.ts'
import { unresolvedWarnings, WARNING_CODES, type ReviewWarningCode } from '../review/model.ts'
import { operatorImpact, pendingPreparations, type PendingPreparation } from './impact.ts'
import { operatorReview, sourceHistory } from './projection.ts'
import { batchDependencies, retainedReviews } from './review-state.ts'

type OperatorOutcome = BulkEditResultDto | RestructureResultDto

const PREVIEW_SAVEPOINT = 'operator_preview'

function commandScope(
  config: ManualConfig,
  action: string,
  batchId: string,
  key: string,
): CommandScope {
  return {
    actorId: config.actorId,
    action,
    resourceKey: `${config.targetId}:${config.targetContextId}:${batchId}`,
    key,
  }
}

async function readOnly(client: PoolClient) {
  await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
}

/** Preparation → whether its exact selection bytes match the given facts. */
async function preparationCurrency(
  client: PoolClient,
  config: ManualConfig,
  snapshot: CaptureSnapshotDto,
  preparations: PendingPreparation[],
) {
  const currency = new Map<string, boolean>()
  for (const preparation of preparations) {
    const material = await materializeWithMedia(client, config, snapshot, preparation.lotIds, false)
    const current =
      !material.issues.length &&
      !unresolvedWarnings(material).length &&
      material.bytes.equals(preparation.dependencyBytes)
    currency.set(preparation.id, current)
  }
  return currency
}

/** Facts needed to measure exactly what a command changes. */
async function dependencyState(
  client: PoolClient,
  config: ManualConfig,
  snapshot: CaptureSnapshotDto,
) {
  const context = await loadReviewContext(client, snapshot.id)
  return batchDependencies(client, config, snapshot, context)
}

/** Restructuring keeps contribution identity for anything an approval already includes. */
async function requireUnapproved(
  client: PoolClient,
  config: ManualConfig,
  scope: OperatorCommandScope,
  lotIds: readonly string[],
) {
  const keys = scope.snapshot.lots
    .filter((lot) => lotIds.includes(lot.id))
    .map((lot) => lot.contribution_key)
  const history = await sourceHistory(
    client,
    config,
    { sourceId: scope.sourceId, originalSourceKey: scope.sourceId },
    keys,
  )
  if (history.approvedContributionKeys.size) {
    fail('lot_already_approved', 409)
  }
}

function restructuredLotIds(input: RestructureDto): string[] {
  switch (input.change.kind) {
    case 'split_lot':
      return [input.change.lot_id]
    case 'merge_lots':
    case 'move_lots':
      return input.change.lot_ids
  }
}

/** Without previewOnly the change is applied; a preview runs it in a savepoint and rolls back. */
async function measuredCommand(
  client: PoolClient,
  config: ManualConfig,
  batchId: string,
  input: { expected_revision: string; preview: boolean },
  apply: (scope: OperatorCommandScope) => Promise<StructuralOutcome>,
): Promise<OperatorOutcome> {
  const scope = await lockCaptureForOperatorCommand(
    client,
    config,
    batchId,
    input.expected_revision,
  )
  const before = await dependencyState(client, config, scope.snapshot)
  const reviews = await retainedReviews(client, batchId)
  const preparations = await pendingPreparations(client, batchId, config.actorId)
  const preparationsBefore = await preparationCurrency(client, config, scope.snapshot, preparations)
  if (input.preview) {
    await client.query(`SAVEPOINT ${PREVIEW_SAVEPOINT}`)
  }

  const outcome = await apply(scope)
  const afterSnapshot = await scope.commit(input)
  const after = await dependencyState(client, config, afterSnapshot)
  const preparationsAfter = await preparationCurrency(client, config, afterSnapshot, preparations)
  const impact = operatorImpact({
    before,
    after,
    reviews,
    preparationsBefore,
    preparationsAfter,
    retiredLotIds: outcome.retiredLotIds,
    createdLots: outcome.createdLots,
    createdPart: outcome.createdPart,
  })

  if (!input.preview) {
    const applied: OperatorOutcomeDto = {
      status: 'applied',
      revision: afterSnapshot.revision,
      impact,
    }
    validate('RestructureResult', applied)
    return applied
  }
  await client.query(`ROLLBACK TO SAVEPOINT ${PREVIEW_SAVEPOINT}`)
  // A preview has no identities: nothing it describes exists.
  const previewed: OperatorOutcomeDto = {
    status: 'previewed',
    revision: input.expected_revision,
    impact: {
      ...impact,
      created_lots: impact.created_lots.map((lot) => ({ lot_id: null, label: lot.label })),
      created_part: impact.created_part && { part_id: null, label: impact.created_part.label },
    },
  }
  validate('RestructureResult', previewed)
  return previewed
}

function isWarningCode(code: string): code is ReviewWarningCode {
  return (WARNING_CODES as readonly string[]).includes(code)
}

/** The dismissal must name a warning that is raised now, against its exact current facts. */
async function requireCurrentWarning(
  client: PoolClient,
  config: ManualConfig,
  scope: OperatorCommandScope,
  input: IssueDispositionDto,
) {
  if (!isWarningCode(input.code)) {
    fail('issue_not_dismissible', 409)
  }
  const dependencies = await dependencyState(client, config, scope.snapshot)
  const warnings = [...dependencies.lots.values()].flatMap((lot) => lot.material.warnings)
  const warning = warnings.find(
    (value) => value.subjectId === input.subject_id && value.code === input.code,
  )
  if (!warning) {
    fail('issue_not_found', 404)
  }
  if (warning.factDigest !== input.dependency_digest) {
    fail('stale_issue', 409)
  }
}

export function operatorRepository(pool: Pool, config: ManualConfig) {
  function command<T>(
    action: string,
    batchId: string,
    key: string,
    payload: unknown,
    work: (client: PoolClient) => Promise<T>,
  ) {
    return transaction(pool, async (client) => {
      const result = await idempotent(
        client,
        commandScope(config, action, batchId, key),
        payload,
        () => work(client),
      )
      return result as T
    })
  }

  function measured(
    action: string,
    batchId: string,
    key: string,
    input: BulkEditDto | RestructureDto,
    apply: (client: PoolClient, scope: OperatorCommandScope) => Promise<StructuralOutcome>,
  ): Promise<OperatorOutcome> {
    if (input.preview) {
      // Previews commit nothing, so they retain no idempotency record either.
      return transaction(pool, (client) =>
        measuredCommand(client, config, batchId, input, (scope) => apply(client, scope)),
      )
    }
    return command(action, batchId, key, input, (client) =>
      measuredCommand(client, config, batchId, input, (scope) => apply(client, scope)),
    )
  }

  return {
    read(batchId: string): Promise<OperatorReviewDto> {
      return transaction(pool, async (client) => {
        await readOnly(client)
        return operatorReview(client, config, batchId)
      })
    },

    dismiss(batchId: string, key: string, input: IssueDispositionDto) {
      return command('operator_dismiss', batchId, key, input, async (client) => {
        const scope = await lockCaptureForOperatorCommand(
          client,
          config,
          batchId,
          input.expected_batch_revision,
        )
        await requireCurrentWarning(client, config, scope, input)
        await recordDisposition(client, scope, {
          subjectId: input.subject_id,
          code: input.code,
          dependencyDigest: input.dependency_digest,
          reason: input.reason,
        })
        await scope.commit(input)
        return operatorReview(client, config, batchId)
      })
    },

    bulkEdit(batchId: string, key: string, input: BulkEditDto) {
      return measured('operator_bulk_edit', batchId, key, input, (_client, scope) =>
        applyBulkEdit(scope, input),
      )
    },

    restructure(batchId: string, key: string, input: RestructureDto) {
      return measured('operator_restructure', batchId, key, input, async (client, scope) => {
        await requireUnapproved(client, config, scope, restructuredLotIds(input))
        return applyRestructure(client, scope, input)
      })
    },

    instruct(batchId: string, key: string, input: InstructionEditDto) {
      return command('operator_instruct', batchId, key, input, async (client) => {
        const scope = await lockCaptureForOperatorCommand(
          client,
          config,
          batchId,
          input.expected_revision,
        )
        await recordInstruction(client, scope, input)
        await scope.commit(input)
        const result = await operatorReview(client, config, batchId)
        validate('OperatorReview', result)
        return result
      })
    },
  }
}
