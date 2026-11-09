import { effectsCapable } from '../execution/effects/effects-plan.ts'
import { and, desc, eq } from 'drizzle-orm'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import { manualReviews } from './schema.ts'
import { effectsDeployment, type EffectsDeployment } from '../execution/effects/effects-source.ts'
import type { PoolClient } from 'pg'
import type { ManualIssueDto } from '@invimport/contracts'
import type { DevConfig } from '../config.ts'
import { captureInTransaction } from '../capture/repository.ts'
import { fail } from '../capture/model.ts'
import {
  lockStockSource,
  stockSourceHistory,
  stockDeployment,
  type StockDeployment,
} from '../execution/source.ts'
import { mediaDeployment, type MediaDeployment } from '../execution/media-source.ts'
import type { StockPlan } from '../execution/plan.ts'
import { verifyBytes } from '../db/authority.ts'
import { issue, type ManualMaterial } from './model.ts'

export interface ManualConfig extends DevConfig {
  deploymentId?: string
  readOrigin?: string
  mediaEnabled?: boolean
}
export type DeploymentBinding = StockDeployment | MediaDeployment | EffectsDeployment

export function isEffectsBinding(
  binding: DeploymentBinding | null | undefined,
): binding is EffectsDeployment {
  return effectsCapable(binding?.capability)
}

export async function deploymentBinding(
  client: PoolClient,
  config: ManualConfig,
): Promise<DeploymentBinding | null> {
  if (!config.deploymentId || !config.readOrigin) {
    return null
  }
  const input = {
    deploymentId: config.deploymentId,
    targetId: config.targetId,
    contextId: config.targetContextId,
    origin: config.readOrigin,
  }
  const stock = await stockDeployment(client, input)
  if (stock) {
    return stock
  }
  return (await mediaDeployment(client, input)) ?? (await effectsDeployment(client, input))
}

export async function lockedCapture(client: PoolClient, config: ManualConfig, batchId: string) {
  const observed = await captureInTransaction(client, config, batchId)
  const source = {
    targetId: config.targetId,
    sourceId: observed.sourceId,
    originalSourceKey: observed.originalSourceKey,
  }
  const guard = await lockStockSource(client, source)
  const retained = await captureInTransaction(client, config, batchId, true)
  return { ...retained, source, guard }
}

export async function historyIssues(
  client: PoolClient,
  source: Parameters<typeof stockSourceHistory>[1],
  material: ManualMaterial,
  activeRunId: string | null,
): Promise<ManualIssueDto[]> {
  const history = await stockSourceHistory(
    client,
    source,
    material.effects.map((value) => value.contribution_key),
  )
  const issues: ManualIssueDto[] = []
  const blocking = history.runs.find(
    (value) => value.state === 'queued' || value.state === 'recovery_required',
  )
  if (activeRunId || blocking) {
    issues.push(
      issue(
        'source_history_unsettled',
        'An earlier run holds this source. Inspect its original results before approving more stock.',
        null,
        activeRunId ?? blocking!.runId,
      ),
    )
  }
  for (const previous of history.contributions) {
    const effect = material.effects.find(
      (value) => value.contribution_key === previous.contribution_key,
    )
    issues.push(
      issue(
        'original_contribution_already_approved',
        'This original contribution already has an approval. Inspect or recover that run; stock is never replenished.',
        effect?.lot_id ?? null,
        previous.run_id,
      ),
    )
  }
  return issues
}

export interface ReviewBinding {
  subjectId: string
  reviewId: string
  digest: string
}

export async function currentReviews(
  client: PoolClient,
  batchId: string,
  material: ManualMaterial,
): Promise<ReviewBinding[]> {
  const bindings: ReviewBinding[] = []
  for (const subject of material.subjects) {
    const result = await executeDatabaseQuery(
      queryDatabase(client)
        .select({
          id: manualReviews.id,
          dependency_bytes: manualReviews.dependencyBytes,
          dependency_digest: manualReviews.dependencyDigest,
        })
        .from(manualReviews)
        .where(
          and(eq(manualReviews.batchId, batchId), eq(manualReviews.subjectId, subject.subjectId)),
        )
        .orderBy(desc(manualReviews.createdAt), desc(manualReviews.id)),
    )
    const matching = result.find((row) => {
      verifyBytes(row.dependency_bytes, row.dependency_digest)
      return row.dependency_bytes.equals(subject.bytes)
    })
    if (matching) {
      bindings.push({
        subjectId: subject.subjectId,
        reviewId: matching.id,
        digest: subject.digest.toString('hex'),
      })
    }
  }
  return bindings
}

export function requireReviews(material: ManualMaterial, reviews: ReviewBinding[]) {
  if (reviews.length !== material.subjects.length) {
    fail('current_review_required', 409)
  }
}

export function stockPlan(
  binding: StockDeployment,
  sourceId: string,
  originalSourceKey: string,
  material: ManualMaterial,
): StockPlan {
  return {
    version: 'bench-stock-plan/1',
    deploymentId: binding.deploymentId,
    epoch: binding.epoch,
    targetId: binding.targetId,
    contextId: binding.contextId,
    continuity: binding.continuity,
    build: binding.build,
    capability: binding.capability,
    sourceId,
    originalSourceKey,
    operations: material.effects.map((value) => ({
      operationKey: value.lot_id,
      contributionKey: value.contribution_key,
      part: value.part_id ?? fail('unsupported_part_creation', 409),
      location: value.location_id,
      quantity: value.quantity,
      barcode: value.barcode,
    })),
  }
}
