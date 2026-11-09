import type { PoolClient } from 'pg'
import type {
  CaptureSnapshotDto,
  ProcessingBlockerDto,
  ProcessingInputDto,
} from '@invimport/contracts'
import type { CaptureBinding } from '../capture/model.ts'
import { canonical } from '@invimport/contracts/json'
import { readMediaInputScopeResults, decodeMediaInputs, type MediaInputs } from '../media/inputs.ts'
import { lockMediaInputScopes, type LockedMediaInputs } from '../media/locked-inputs.ts'
import { readCommandMediaInputs } from '../media/command-inputs.ts'
import { MediaInputUnavailableError } from '../media/input-errors.ts'
import { fail, processingSubjectScope } from './model.ts'

export type ProcessingMediaAvailability =
  | { available: true; inputs: MediaInputs }
  | {
      available: false
      blockedCode: Extract<ProcessingBlockerDto, 'media_not_ready' | 'media_input_capacity'>
    }

/** Every scope is captured before a Processing lane/job/question lock. Empty scopes also pin. */
export async function reserveProcessingMedia(
  client: PoolClient,
  binding: CaptureBinding,
  snapshot: CaptureSnapshotDto,
  subjectIds: readonly string[],
): Promise<ReadonlyMap<string, LockedMediaInputs>> {
  const uniqueSubjects = [...new Set(subjectIds)].sort()
  const scopes = uniqueSubjects.map((subjectId) => processingSubjectScope(snapshot, subjectId))
  const handles = await lockMediaInputScopes(client, binding, snapshot.id, scopes)
  return new Map(uniqueSubjects.map((subjectId, index) => [subjectId, handles[index]]))
}

/** One authorized snapshot, with known unavailability classified independently for each closure. */
export async function readProcessingMediaScopes(
  client: PoolClient,
  binding: CaptureBinding,
  snapshot: CaptureSnapshotDto,
  subjectIds: readonly string[],
): Promise<ReadonlyMap<string, ProcessingMediaAvailability>> {
  const uniqueSubjects = [...new Set(subjectIds)].sort()
  const scopes = uniqueSubjects.map((subjectId) => processingSubjectScope(snapshot, subjectId))
  const results = await readMediaInputScopeResults(client, binding, snapshot.id, scopes)
  return new Map(
    uniqueSubjects.map((subjectId, index) => {
      const result = results[index]
      const availability: ProcessingMediaAvailability =
        result.kind === 'ready'
          ? { available: true, inputs: result.inputs }
          : { available: false, blockedCode: result.code }
      return [subjectId, availability]
    }),
  )
}

/** Settlement retains media exclusion even when a relevant scope has become unavailable. */
export async function lockProcessingMediaCurrency(
  client: PoolClient,
  binding: CaptureBinding,
  snapshot: CaptureSnapshotDto,
  subjectId: string,
): Promise<ProcessingMediaAvailability> {
  try {
    const reservations = await reserveProcessingMedia(client, binding, snapshot, [subjectId])
    const media = reservedMediaFor(reservations, subjectId)
    const inputs = decodeMediaInputs(
      Buffer.from(media.manifest, 'utf8'),
      Buffer.from(media.manifestDigest, 'hex'),
    )
    return { available: true, inputs }
  } catch (error) {
    if (!(error instanceof MediaInputUnavailableError)) {
      throw error
    }
    const blockedCode = error.reason === 'not_ready' ? 'media_not_ready' : 'media_input_capacity'
    return { available: false, blockedCode }
  }
}

/** V2 authority requires an existing exact immutable command binding, never recovery pin writes. */
export async function verifyRetainedProcessingMedia(
  client: PoolClient,
  binding: CaptureBinding,
  manifest: ProcessingInputDto,
  commandId: string,
): Promise<void> {
  if (manifest.schema_version === 'bench-intake-input/1') {
    return
  }
  const retained = await readCommandMediaInputs(client, binding, manifest.batch_id, commandId)
  const embedded = decodeMediaInputs(
    Buffer.from(manifest.media.manifest, 'utf8'),
    Buffer.from(manifest.media.sha256, 'hex'),
  )
  const retainedSubjects = new Set([manifest.subject_id])
  if (manifest.linked_part) {
    retainedSubjects.add(manifest.linked_part.id)
  }
  const exactBindingMatches =
    embedded.batchId === manifest.batch_id &&
    canonical(embedded.subjectIds) === canonical([...retainedSubjects].sort()) &&
    retained.bytes.equals(embedded.bytes) &&
    retained.digest.equals(embedded.digest)
  if (!exactBindingMatches) {
    fail('processing_media_binding_invalid')
  }
}

export function reservedMediaFor(
  reservations: ReadonlyMap<string, LockedMediaInputs>,
  subjectId: string,
): LockedMediaInputs {
  return reservations.get(subjectId) ?? fail('processing_media_reservation_missing')
}

export function processingMediaFor(
  scopes: ReadonlyMap<string, ProcessingMediaAvailability>,
  subjectId: string,
): ProcessingMediaAvailability {
  return scopes.get(subjectId) ?? fail('processing_media_scope_missing')
}
