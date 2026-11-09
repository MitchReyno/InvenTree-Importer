import { effectsCapable, RECORD_EFFECTS_CAPABILITY } from '../execution/effects/effects-plan.ts'
import type { PoolClient } from 'pg'
import type { ManualScopeDto } from '@invimport/contracts'
import { fail } from '../capture/model.ts'
import { issue, unresolvedWarnings, type ManualMaterial } from './model.ts'
import { lockedCapture, deploymentBinding, historyIssues, type ManualConfig } from './authority.ts'
import { materializeWithMedia } from './media-material.ts'

/** Idempotency scope for one manual command on a batch, or on a preparation for approval. */
export function commandScope(
  config: ManualConfig,
  action: string,
  resourceId: string,
  key: string,
) {
  return {
    actorId: config.actorId,
    action,
    resourceKey: `${config.targetId}:${config.targetContextId}:${resourceId}`,
    key,
  }
}

/** Sorts lot ids so the same selection in any order is the same command payload. */
export function normalizedScope(input: ManualScopeDto) {
  return { ...input, selected_lot_ids: [...input.selected_lot_ids].sort() }
}

/** A warning blocks review and preparation until fixed or dismissed with a reason. */
export function warningIssues(material: ManualMaterial) {
  return unresolvedWarnings(material).map((warning) =>
    issue('warning_unresolved', warning.message, warning.lotId),
  )
}

export async function checkedSelection(
  client: PoolClient,
  config: ManualConfig,
  batchId: string,
  input: ManualScopeDto,
) {
  const capture = await lockedCapture(client, config, batchId)
  if (capture.snapshot.revision !== input.expected_batch_revision) {
    fail('revision_conflict', 412)
  }
  const material = await materializeWithMedia(
    client,
    config,
    capture.snapshot,
    input.selected_lot_ids,
  )
  const binding = await deploymentBinding(client, config)
  const issues = [...material.issues, ...warningIssues(material)]
  if (!binding) {
    issues.push(
      issue(
        'unsupported_capability',
        'Stock execution is available only for a separately configured owned fake target.',
      ),
    )
  }
  if (
    (material.locations?.length || material.companies?.length) &&
    binding?.capability !== RECORD_EFFECTS_CAPABILITY
  ) {
    issues.push(
      issue(
        'record_creation_unavailable',
        'Creating a new location or supplier is not available for this target. Choose an existing record, or keep the draft for later.',
      ),
    )
  }
  if (material.parts.length && !effectsCapable(binding?.capability)) {
    issues.push(
      issue(
        'unsupported_part_creation',
        'This deployment does not support explicit Part creation.',
      ),
    )
  }
  if (
    material.mediaInputs?.size &&
    binding?.capability !== 'owned-fake-media/1' &&
    !effectsCapable(binding?.capability)
  ) {
    issues.push(
      issue(
        'unsupported_media_capability',
        'This retained media scope needs the separately qualified owned fake media capability.',
      ),
    )
  }
  const partAttachmentSelected = [...(material.mediaInputs?.values() ?? [])].some((inputs) =>
    inputs.attachments.some((selection) => selection.destination === 'part_attachment'),
  )
  if (partAttachmentSelected && !effectsCapable(binding?.capability)) {
    issues.push(
      issue(
        'unsupported_part_attachment',
        'This deployment does not support Part attachments. Decline the Part attachment or use the owned fake effects capability.',
      ),
    )
  }
  issues.push(...(await historyIssues(client, capture.source, material, capture.guard.activeRunId)))
  return { capture, material, binding, issues }
}
