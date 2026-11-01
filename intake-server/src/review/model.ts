import type { CaptureSnapshotDto, ManualEffectDto, ManualIssueDto } from '@invimport/contracts'
import { canonical } from '@invimport/contracts/json'
import { sha256 } from '../db/authority.ts'
import type { MediaInputs } from '../media/inputs.ts'
import { contributionBarcode } from '../execution/plan.ts'

export interface SubjectDependency {
  subjectId: string
  bytes: Buffer
  digest: Buffer
}
export interface ManualMaterial {
  selected: string[]
  effects: ManualEffectDto[]
  subjects: SubjectDependency[]
  issues: ManualIssueDto[]
  bytes: Buffer
  digest: Buffer
  mediaInputs?: ReadonlyMap<string, MediaInputs>
}
export function issue(
  code: string,
  message: string,
  lotId: string | null = null,
  runId: string | null = null,
): ManualIssueDto {
  return { code, message, lot_id: lotId, run_id: runId }
}

/** Exact selected dependency closure: explicit overrides exclude irrelevant default changes. */
export function materialize(
  snapshot: CaptureSnapshotDto,
  selectedIds: string[],
  mediaDigests: ReadonlyMap<string, string> = new Map(),
): ManualMaterial {
  const selected = [...selectedIds].sort()
  const issues: ManualIssueDto[] = []
  const effects: ManualEffectDto[] = []
  const subjects = new Map<string, SubjectDependency>()
  function retain(subjectId: string, value: unknown) {
    const bytes = Buffer.from(canonical(value))
    subjects.set(subjectId, { subjectId, bytes, digest: sha256(bytes) })
  }
  if (snapshot.archived) {
    issues.push(issue('batch_archived', 'Resume this batch before reviewing or approving.'))
  }
  for (const lotId of selected) {
    const lot = snapshot.lots.find((value) => value.id === lotId)
    if (!lot) {
      issues.push(
        issue('lot_not_found', 'The selected physical lot does not belong to this batch.', lotId),
      )
      continue
    }
    const part = snapshot.parts.find((value) => value.id === lot.part_subject_id)
    const quantity = lot.quantity.mode === 'inherit' ? snapshot.defaults.quantity : lot.quantity
    const location = lot.location.mode === 'inherit' ? snapshot.defaults.location : lot.location
    if (!part || part.choice.mode !== 'set') {
      issues.push(
        issue('part_choice_required', 'Choose an observed existing Part for this lot.', lotId),
      )
    }
    if (quantity.mode !== 'set') {
      issues.push(
        issue('quantity_required', 'Choose an exact positive quantity for this lot.', lotId),
      )
    }
    if (location.mode !== 'set' && location.mode !== 'clear') {
      issues.push(
        issue(
          'location_required',
          'Choose an observed location or explicitly choose no location.',
          lotId,
        ),
      )
    }
    const notes = snapshot.notes.filter(
      (value) =>
        value.subject_id === null || value.subject_id === lotId || value.subject_id === part?.id,
    )
    if (part) {
      retain(part.id, {
        version: mediaDigests.has(part.id) ? 'manual-part-review/2' : 'manual-part-review/1',
        ...(mediaDigests.has(part.id) ? { mediaDigest: mediaDigests.get(part.id) } : {}),
        batchId: snapshot.id,
        title: snapshot.title,
        targetContextId: snapshot.target_context_id,
        part,
        notes: snapshot.notes.filter(
          (value) => value.subject_id === null || value.subject_id === part.id,
        ),
      })
    }
    retain(lotId, {
      version: mediaDigests.has(lotId) ? 'manual-lot-review/2' : 'manual-lot-review/1',
      ...(mediaDigests.has(lotId) ? { mediaDigest: mediaDigests.get(lotId) } : {}),
      batchId: snapshot.id,
      title: snapshot.title,
      sourceId: snapshot.source_id,
      targetContextId: snapshot.target_context_id,
      lot,
      effectiveQuantity: quantity,
      effectiveLocation: location,
      partDigest: part ? subjects.get(part.id)!.digest.toString('hex') : null,
      notes,
    })
    if (
      part?.choice.mode === 'set' &&
      quantity.mode === 'set' &&
      (location.mode === 'set' || location.mode === 'clear')
    ) {
      const partRef = part.choice.value
      const locationRef = location.mode === 'set' ? location.value : null
      const partObservation = snapshot.observations.find(
        (value) => value.id === partRef.observation_id,
      )
      const locationObservation = locationRef
        ? snapshot.observations.find((value) => value.id === locationRef.observation_id)
        : null
      if (
        !partObservation ||
        partObservation.model !== 'part' ||
        partObservation.pk !== partRef.pk ||
        partObservation.target_context_id !== snapshot.target_context_id ||
        partRef.target_context_id !== snapshot.target_context_id ||
        partRef.model !== 'part' ||
        (locationRef &&
          (!locationObservation ||
            locationObservation.model !== 'location' ||
            locationObservation.pk !== locationRef.pk ||
            locationObservation.target_context_id !== snapshot.target_context_id ||
            locationRef.target_context_id !== snapshot.target_context_id ||
            locationRef.model !== 'location'))
      ) {
        issues.push(
          issue(
            'observation_binding_invalid',
            'An existing-record choice no longer matches retained target evidence.',
            lotId,
          ),
        )
        continue
      }
      effects.push({
        lot_id: lotId,
        lot_label: lot.label,
        part_id: partRef.pk,
        part_label: partObservation.label,
        quantity: quantity.value,
        location_id: locationRef?.pk ?? null,
        location_label: locationObservation?.label ?? 'No location',
        contribution_key: lot.contribution_key,
        barcode: contributionBarcode(snapshot.source_id, lot.contribution_key),
      })
    }
  }
  const retainedSubjects = [...subjects.values()].sort((a, b) =>
    a.subjectId.localeCompare(b.subjectId),
  )
  const bytes = Buffer.from(
    canonical({
      version: mediaDigests.size ? 'manual-selection/2' : 'manual-selection/1',
      batchId: snapshot.id,
      sourceId: snapshot.source_id,
      selected,
      subjects: retainedSubjects.map((value) => ({
        subjectId: value.subjectId,
        digest: value.digest.toString('hex'),
      })),
      effects,
    }),
  )
  return { selected, effects, subjects: retainedSubjects, issues, bytes, digest: sha256(bytes) }
}
