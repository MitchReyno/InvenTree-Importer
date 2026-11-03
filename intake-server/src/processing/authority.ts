import type { PoolClient } from 'pg'
import { and, eq, getTableColumns } from 'drizzle-orm'
import type { CaptureSnapshotDto, ProcessingInputDto } from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import { commands } from '../db/schema.ts'
import { canonical } from '@invimport/contracts/json'
import {
  fail,
  ProcessingError,
  inputManifest,
  mediaInputManifest,
  nativeInputManifest,
  researchInputManifest,
  approvedResearchSources,
  decodeProcessingInput,
  decodeProcessingCommand,
  type Stage,
} from './model.ts'
import { verifyBytes } from '../db/authority.ts'
import { processingProfiles } from './policy.ts'
import type { MediaInputs } from '../media/inputs.ts'
import { verifyRetainedProcessingMedia } from './media.ts'
import type { ProcessingConfig } from './attempts.ts'
import {
  processingAttempts,
  processingDependencies,
  processingInputs,
  processingJobs,
  processingProfileRecords,
} from './schema.ts'

async function verifyDependencyBinding(
  client: PoolClient,
  attemptId: string,
  manifest: ProcessingInputDto,
) {
  const dependencies = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ attemptId: processingDependencies.dependencyAttemptId })
      .from(processingDependencies)
      .where(eq(processingDependencies.attemptId, attemptId))
      .orderBy(processingDependencies.dependencyAttemptId)
      .limit(manifest.dependencies.length + 1),
  )
  const retainedIds = dependencies.map((dependency) => dependency.attemptId)
  const manifestIds = [...manifest.dependencies].sort()
  if (canonical(retainedIds) !== canonical(manifestIds)) {
    fail('processing_dependency_binding_invalid')
  }
}

export async function loadProcessingAuthority(
  client: PoolClient,
  config: ProcessingConfig,
  attemptId: string,
) {
  const authorities = await executeDatabaseQuery(
    queryDatabase(client)
      .select({
        ...getTableColumns(processingAttempts),
        manifestBytes: processingInputs.manifestBytes,
        manifestDigest: processingInputs.manifestDigest,
        captureRevision: processingInputs.captureRevision,
        payloadBytes: commands.payloadBytes,
        payloadDigest: commands.payloadDigest,
        actorId: commands.actorId,
        targetId: commands.targetId,
        targetContextId: commands.targetContextId,
        handlerVersion: commands.handlerVersion,
        workflowId: commands.workflowId,
        queueName: commands.queueName,
        kind: commands.kind,
        instructionBytes: processingProfileRecords.instructionBytes,
        instructionDigest: processingProfileRecords.instructionDigest,
        toolProfileVersion: processingProfileRecords.toolProfileVersion,
        subjectId: processingJobs.subjectId,
        stage: processingJobs.stage,
        currentAttemptId: processingJobs.currentAttemptId,
        jobState: processingJobs.state,
      })
      .from(processingAttempts)
      .innerJoin(processingInputs, eq(processingInputs.id, processingAttempts.inputId))
      .innerJoin(commands, eq(commands.id, processingAttempts.commandId))
      .innerJoin(
        processingProfileRecords,
        eq(processingProfileRecords.id, processingAttempts.profileId),
      )
      .innerJoin(
        processingJobs,
        and(
          eq(processingJobs.id, processingAttempts.jobId),
          eq(processingJobs.batchId, processingAttempts.batchId),
        ),
      )
      .where(eq(processingAttempts.id, attemptId)),
  )
  const row = authorities[0]
  if (
    !row ||
    row.actorId !== config.actorId ||
    row.targetId !== config.targetId ||
    row.targetContextId !== config.targetContextId
  ) {
    fail('attempt_not_found', 404)
  }
  const profile = processingProfiles[row.profileId as keyof typeof processingProfiles]
  if (!profile) {
    fail('processing_profile_version_conflict')
  }
  verifyBytes(row.instructionBytes, row.instructionDigest)
  const profileMatches =
    row.instructionDigest.toString('hex') === profile.instructionDigest &&
    row.instructionBytes.toString('utf8') === profile.instructions &&
    row.toolProfileVersion === profile.toolProfileVersion
  if (!profileMatches) {
    fail('processing_profile_version_conflict')
  }

  const manifest = decodeProcessingInput(row.manifestBytes, row.manifestDigest)
  const payload = decodeProcessingCommand(row.payloadBytes, row.payloadDigest)
  const expected = {
    schema_version: profile.commandSchemaVersion,
    job_id: row.jobId,
    attempt_id: row.id,
    input_id: row.inputId,
    input_sha256: row.manifestDigest.toString('hex'),
    profile_id: manifest.profile_id,
    handler_version: profile.handlerVersion,
    command_id: row.commandId,
  }
  if (
    canonical(payload) !== canonical(expected) ||
    row.handlerVersion !== profile.handlerVersion ||
    row.profileId !== manifest.profile_id ||
    row.workflowId !== `processing:${row.id}` ||
    row.queueName !== 'bench-research' ||
    !['process', 'continue'].includes(row.kind) ||
    manifest.batch_id !== row.batchId ||
    manifest.subject_id !== row.subjectId ||
    manifest.stage !== row.stage ||
    manifest.instruction_version !== profile.instructionVersion ||
    manifest.instruction_sha256 !== profile.instructionDigest ||
    manifest.tool_profile_version !== profile.toolProfileVersion
  ) {
    fail('processing_authority_corrupt')
  }
  await verifyRetainedProcessingMedia(client, config, manifest, row.commandId)
  await verifyDependencyBinding(client, row.id, manifest)
  return { row, manifest, payload }
}

export function processingInputIsCurrent(
  manifest: ProcessingInputDto,
  snapshot: CaptureSnapshotDto,
  media: MediaInputs,
  approvedSourceUrls: readonly string[] = [],
) {
  // Defensive: the projected retired flag already changes the recomputed manifest.
  // A retired lot's work is stale; unrelated batch changes still do not invalidate this subject.
  const retiredSubject = snapshot.lots.some(
    (lot) => lot.id === manifest.subject_id && lot.retired === true,
  )
  if (retiredSubject) {
    return false
  }
  if (
    manifest.schema_version === 'bench-intake-input/1' &&
    (media.versions.length > 0 || media.attachments.length > 0)
  ) {
    return false
  }
  if (manifest.schema_version === 'bench-intake-input/3') {
    const admitted = new Set(approvedResearchSources(approvedSourceUrls))
    if (manifest.source_urls.some((url) => !admitted.has(url))) {
      return false
    }
  }
  const argumentsForInput = [
    snapshot,
    manifest.subject_id,
    manifest.stage as Stage,
    manifest.dependencies,
    manifest.answer_id,
  ] as const
  let current: ProcessingInputDto
  try {
    const descriptor = {
      manifest: media.bytes.toString('utf8'),
      sha256: media.digest.toString('hex'),
    }
    if (manifest.schema_version === 'bench-intake-input/1') {
      current = inputManifest(...argumentsForInput)
    } else if (manifest.schema_version === 'bench-intake-input/4') {
      current = nativeInputManifest(...argumentsForInput, descriptor, {
        revision: manifest.settings_revision,
        selection: manifest.agent,
      })
    } else if (manifest.schema_version === 'bench-intake-input/3') {
      current = researchInputManifest(...argumentsForInput, descriptor, manifest.source_urls)
    } else {
      current = mediaInputManifest(...argumentsForInput, descriptor)
    }
  } catch (error) {
    const closed =
      error instanceof ProcessingError &&
      [
        'retained_evidence_required',
        'retained_manual_evidence_required',
        'unsupported_processing_input',
      ].includes(error.code)
    if (closed) {
      return false
    }
    throw error
  }
  current.capture_revision = manifest.capture_revision
  return canonical(current) === canonical(manifest)
}
