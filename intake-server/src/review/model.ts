import { captureContextRecords } from '../capture/context-input.ts'
import { validatePartSpec, PartSpecError } from '../capture/part-spec.ts'
import { locationCreateKey, logicalEffectKey } from '../execution/effects/effects-plan.ts'
import type { InventoryPartSpecDto } from '@invimport/contracts'
import type { CaptureSnapshotDto, ManualEffectDto, ManualIssueDto } from '@invimport/contracts'
import {
  defaultLocationDraft as sharedDefaultLocationDraft,
  resolveLotLocation,
  type LotLocationGroups,
  type LotLocationResolution,
} from '@invimport/contracts'
import { canonical } from '@invimport/contracts/json'
import { sha256 } from '../db/authority.ts'
import type { MediaInputs, MediaInputVersion } from '../media/inputs.ts'
import { contributionBarcode } from '../execution/plan.ts'
import {
  EMPTY_REVIEW_CONTEXT,
  type CaptureReviewContext,
  type IssueDispositionRecord,
} from '../capture/review-context.ts'

export interface SubjectDependency {
  subjectId: string
  bytes: Buffer
  digest: Buffer
  /** Digest of the subject's facts alone; warning dismissals bind to it. */
  factDigest: Buffer
}

/** Deterministic warnings: each needs a fix or a recorded reasoned dismissal before review. */
export type ReviewWarningCode = 'no_supporting_evidence' | 'possible_duplicate_part'

export interface ReviewWarning {
  code: ReviewWarningCode
  message: string
  subjectId: string
  lotId: string | null
  factDigest: string
  disposition: IssueDispositionRecord | null
}

/** A reviewed new-location draft: the parent is an existing observed location PK or null. */
export interface MaterialLocation {
  draftId: string
  spec: { name: string; description: string; parent: string | null }
}
/** A reviewed new-supplier draft; the logo is resolved to retained media at preparation. */
export interface MaterialCompany {
  draftId: string
  spec: { name: string; description: string; isManufacturer: boolean }
  logo: { evidence_id: string; version_id: string } | null
  /** The ready logo version, then its original when it is a crop; set only with media. */
  logoVersions?: MediaInputVersion[]
}

export interface ManualMaterial {
  selected: string[]
  parts: { subjectId: string; spec: InventoryPartSpecDto }[]
  /** Absent for legacy material; present only when a draft is reviewed for creation. */
  locations?: MaterialLocation[]
  companies?: MaterialCompany[]
  partDestinations: Map<string, string | null>
  effects: ManualEffectDto[]
  subjects: SubjectDependency[]
  issues: ManualIssueDto[]
  warnings: ReviewWarning[]
  bytes: Buffer
  digest: Buffer
  mediaConfigured?: true
  mediaInputs?: ReadonlyMap<string, MediaInputs>
}

export const WARNING_CODES: readonly ReviewWarningCode[] = [
  'no_supporting_evidence',
  'possible_duplicate_part',
]

const WARNING_MESSAGES: Record<ReviewWarningCode, string> = {
  no_supporting_evidence:
    'No note or linked media on this lot, its Part proposal or its predecessors supports it.',
  possible_duplicate_part:
    'Another Part proposal in this batch chooses the same existing Part. Share one proposal unless they differ.',
}

/** Successors inherit predecessor evidence; lineage depth is bounded by subject capacity. */
const MAX_LINEAGE_DEPTH = 100

/** Issue messages hold 256 characters; a long exclusion reason is shortened to fit. */
function clipReason(reason: string) {
  const characters = Array.from(reason)
  return characters.length > 200 ? `${characters.slice(0, 199).join('')}…` : reason
}

export function issue(
  code: string,
  message: string,
  lotId: string | null = null,
  runId: string | null = null,
): ManualIssueDto {
  return { code, message, lot_id: lotId, run_id: runId }
}

type Lot = CaptureSnapshotDto['lots'][number]
type Part = CaptureSnapshotDto['parts'][number]

export function ancestorLotIds(context: CaptureReviewContext, lotId: string): string[] {
  const found = new Set<string>()
  let frontier = context.predecessors.get(lotId) ?? []
  for (let depth = 0; frontier.length && depth < MAX_LINEAGE_DEPTH; depth += 1) {
    const next: string[] = []
    for (const id of frontier) {
      if (!found.has(id)) {
        found.add(id)
        next.push(...(context.predecessors.get(id) ?? []))
      }
    }
    frontier = next
  }
  return [...found].sort()
}

function activePartIds(snapshot: CaptureSnapshotDto, context: CaptureReviewContext) {
  const ids = new Set<string>()
  for (const lot of snapshot.lots) {
    if (lot.part_subject_id && !context.retiredLotIds.has(lot.id)) {
      ids.add(lot.part_subject_id)
    }
  }
  return ids
}

function duplicatesExistingPart(
  snapshot: CaptureSnapshotDto,
  context: CaptureReviewContext,
  part: Part,
) {
  if (part.choice.mode !== 'set') {
    return false
  }
  const pk = part.choice.value.pk
  const active = activePartIds(snapshot, context)
  return snapshot.parts.some(
    (other) =>
      other.id !== part.id &&
      active.has(other.id) &&
      other.choice.mode === 'set' &&
      other.choice.value.pk === pk,
  )
}

function hasSupportingEvidence(
  snapshot: CaptureSnapshotDto,
  context: CaptureReviewContext,
  lot: Lot,
  mediaDigests: ReadonlyMap<string, string>,
  linkedMediaSubjects: ReadonlySet<string>,
) {
  const evidenceSubjects = new Set([lot.id, ...ancestorLotIds(context, lot.id)])
  if (lot.part_subject_id) {
    evidenceSubjects.add(lot.part_subject_id)
  }
  const noted = snapshot.notes.some(
    (note) =>
      note.subject_id !== null && evidenceSubjects.has(note.subject_id) && note.text.trim() !== '',
  )
  const linked = [...evidenceSubjects].some(
    (subjectId) => mediaDigests.has(subjectId) || linkedMediaSubjects.has(subjectId),
  )
  return noted || linked
}

function currentDisposition(
  context: CaptureReviewContext,
  subjectId: string,
  code: ReviewWarningCode,
  factDigest: string,
) {
  const records = context.dispositions.get(subjectId) ?? []
  const matching = records.find(
    (record) => record.code === code && record.dependencyDigest === factDigest,
  )
  return matching ?? null
}

const unresolvedLocation = { mode: 'unknown' } as const

/** The Default-location draft, shaped for the plan; validity is shared with the records read. */
function defaultLocationDraft(
  snapshot: CaptureSnapshotDto,
): { location: MaterialLocation; label: string; parentValid: boolean } | null {
  const draft = sharedDefaultLocationDraft(snapshot)
  if (!draft) {
    return null
  }
  return {
    location: {
      draftId: draft.draftId,
      spec: {
        name: draft.value.name,
        description: draft.value.description,
        parent: draft.value.parent?.pk ?? null,
      },
    },
    label: `${draft.value.name} (new location)`,
    parentValid: draft.parentValid,
  }
}

/** A new-supplier draft is created once per run when the batch supplier selects it. */
function supplierDraft(snapshot: CaptureSnapshotDto): MaterialCompany | null {
  const supplier = snapshot.settings_intent?.value.supplier
  if (!supplier || supplier.absent || supplier.selection.mode !== 'draft') {
    return null
  }
  const draftId = supplier.selection.draft_id
  const draft = snapshot.reference_drafts?.find(
    (record) => record.draft_id === draftId && record.kind === 'company',
  )
  if (!draft || draft.kind !== 'company') {
    return null
  }
  return {
    draftId,
    spec: {
      name: draft.value.name,
      description: draft.value.description,
      isManufacturer: draft.value.also_manufacturer,
    },
    logo: draft.value.logo,
  }
}

function locationSourceFact(resolution: LotLocationResolution) {
  if (resolution.status === 'resolved' && resolution.source === 'part') {
    return { locationSource: { scope: 'part' } }
  }
  if (resolution.status === 'resolved' && resolution.source === 'group') {
    return { locationSource: { scope: 'group', groupIds: resolution.group_ids } }
  }
  return {}
}

/** Exact selected dependency closure: explicit overrides exclude irrelevant default changes. */
export function materialize(
  snapshot: CaptureSnapshotDto,
  selectedIds: string[],
  mediaDigests: ReadonlyMap<string, string> = new Map(),
  context: CaptureReviewContext = EMPTY_REVIEW_CONTEXT,
  /** Subjects with linked media, including retired predecessors; presence only, never sealed. */
  linkedMediaSubjects: ReadonlySet<string> = new Set(),
  /** Groups holding each lot's linked evidence; null while media membership is unknown. */
  lotGroups: LotLocationGroups | null = null,
): ManualMaterial {
  const selected = [...selectedIds].sort()
  const locationDraft = defaultLocationDraft(snapshot)
  const supplier = supplierDraft(snapshot)
  const usedLocationDrafts = new Map<string, MaterialLocation>()
  const issues: ManualIssueDto[] = []
  const effects: ManualEffectDto[] = []
  const newParts = new Map<string, InventoryPartSpecDto>()
  const partDestinations = new Map<string, string | null>()
  const subjects = new Map<string, SubjectDependency>()
  const warnings = new Map<string, ReviewWarning>()

  /**
   * Retained /1 and /2 bytes are unchanged when a subject has no lineage or dismissal.
   * Otherwise /3 wraps the same facts with current dispositions and predecessor IDs.
   */
  function retain(
    subjectId: string,
    lotId: string | null,
    facts: unknown,
    raised: ReviewWarningCode[],
    predecessorLotIds: string[] = [],
    dismissalFacts: unknown = facts,
  ) {
    const factBytes = Buffer.from(canonical(facts))
    const factDigest = sha256(Buffer.from(canonical(dismissalFacts)))
    const factHex = factDigest.toString('hex')
    const dispositions: IssueDispositionRecord[] = []
    for (const code of raised) {
      const disposition = currentDisposition(context, subjectId, code, factHex)
      if (disposition) {
        dispositions.push(disposition)
      }
      warnings.set(`${subjectId}:${code}`, {
        code,
        message: WARNING_MESSAGES[code],
        subjectId,
        lotId,
        factDigest: factHex,
        disposition,
      })
    }
    if (!dispositions.length && !predecessorLotIds.length) {
      subjects.set(subjectId, {
        subjectId,
        bytes: factBytes,
        digest: sha256(factBytes),
        factDigest,
      })
      return
    }
    const bytes = Buffer.from(
      canonical({
        version: 'manual-subject-review/3',
        facts,
        dispositions: dispositions.map((value) => ({
          id: value.id,
          code: value.code,
          reason: value.reason,
        })),
        predecessorLotIds,
      }),
    )
    subjects.set(subjectId, { subjectId, bytes, digest: sha256(bytes), factDigest })
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
    if (context.retiredLotIds.has(lotId)) {
      issues.push(
        issue('lot_retired', 'This lot was split or merged; review its successor lots.', lotId),
      )
      continue
    }
    if (lot.excluded) {
      issues.push(
        issue(
          'lot_excluded',
          `Excluded: ${clipReason(lot.excluded.reason)}. Include it again to add it.`,
          lotId,
        ),
      )
      continue
    }
    const part = snapshot.parts.find((value) => value.id === lot.part_subject_id)
    const quantity = lot.quantity.mode === 'inherit' ? snapshot.defaults.quantity : lot.quantity
    const resolution = resolveLotLocation(snapshot, lot, lotGroups)
    const location = resolution.status === 'resolved' ? resolution.location : unresolvedLocation
    const draftLocation =
      resolution.status === 'resolved' && resolution.source === 'batch' && location.mode === 'unset'
        ? locationDraft
        : null
    const placed = location.mode === 'set' || location.mode === 'clear' || draftLocation !== null
    if (draftLocation && !draftLocation.parentValid) {
      issues.push(
        issue(
          'location_draft_parent_invalid',
          "The new location's parent no longer matches a retained location. Choose its parent again.",
          lotId,
        ),
      )
    }
    if (!part || (part.choice.mode !== 'set' && part.choice.mode !== 'create')) {
      issues.push(
        issue(
          'part_choice_required',
          'Explicitly choose a new Part or an observed existing Part for this lot.',
          lotId,
        ),
      )
    }
    if (quantity.mode !== 'set') {
      issues.push(
        issue('quantity_required', 'Choose an exact positive quantity for this lot.', lotId),
      )
    } else if (lot.origin === 'agent' && lot.quantity.mode === 'inherit') {
      // An AI lot's count is only an estimate: the operator accepts or replaces it on the lot,
      // never through the batch default.
      issues.push(
        issue(
          'quantity_required',
          'Accept or replace the estimated quantity on this lot before approving it.',
          lotId,
        ),
      )
    }
    if (resolution.status === 'conflict') {
      issues.push(
        issue(
          'location_conflict',
          'Evidence groups for this lot assign different locations. Choose a lot, shared Part or single group location.',
          lotId,
        ),
      )
    } else if (resolution.status === 'groups_unavailable') {
      issues.push(
        issue(
          'location_groups_unavailable',
          'Evidence group locations could not be confirmed. Retry when media is available or choose a lot location.',
          lotId,
        ),
      )
    } else if (!placed) {
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
    if (part?.choice.mode === 'create') {
      partDestinations.set(part.id, null)
    } else if (part?.choice.mode === 'set') {
      partDestinations.set(part.id, part.choice.value.pk)
    }
    if (part) {
      const partContext = captureContextRecords(snapshot, null)
      const partFacts = {
        ...(partContext.length ? { captureContext: partContext } : {}),
        version: mediaDigests.has(part.id) ? 'manual-part-review/2' : 'manual-part-review/1',
        ...(mediaDigests.has(part.id) ? { mediaDigest: mediaDigests.get(part.id) } : {}),
        batchId: snapshot.id,
        title: snapshot.title,
        targetContextId: snapshot.target_context_id,
        part,
        notes: snapshot.notes.filter(
          (value) => value.subject_id === null || value.subject_id === part.id,
        ),
      }
      const partWarnings: ReviewWarningCode[] = []
      if (duplicatesExistingPart(snapshot, context, part)) {
        partWarnings.push('possible_duplicate_part')
      }
      retain(part.id, null, partFacts, partWarnings)
    }
    const lotContext = captureContextRecords(snapshot, lotId)
    const lotFacts = {
      ...(lotContext.length ? { captureContext: lotContext } : {}),
      version: mediaDigests.has(lotId) ? 'manual-lot-review/2' : 'manual-lot-review/1',
      ...(mediaDigests.has(lotId) ? { mediaDigest: mediaDigests.get(lotId) } : {}),
      batchId: snapshot.id,
      title: snapshot.title,
      sourceId: snapshot.source_id,
      targetContextId: snapshot.target_context_id,
      lot,
      effectiveQuantity: quantity,
      effectiveLocation: location,
      // Only a lot that uses a new-location draft records it, so other fact bytes are unchanged.
      ...(draftLocation ? { locationDraft: draftLocation.location } : {}),
      // A selected supplier draft is created for every lot's run, so its content binds review.
      ...(supplier ? { supplierDraft: supplier } : {}),
      // Lot and batch sources keep the original fact bytes; other sources are recorded.
      ...locationSourceFact(resolution),
      partDigest: part ? subjects.get(part.id)!.digest.toString('hex') : null,
      notes,
    }
    const lotWarnings: ReviewWarningCode[] = []
    if (!hasSupportingEvidence(snapshot, context, lot, mediaDigests, linkedMediaSubjects)) {
      lotWarnings.push('no_supporting_evidence')
    }
    // A lot dismissal binds to the Part's facts, not to the Part's own dismissals.
    const lotDismissalFacts = {
      ...lotFacts,
      partDigest: part ? subjects.get(part.id)!.factDigest.toString('hex') : null,
    }
    retain(
      lotId,
      lotId,
      lotFacts,
      lotWarnings,
      context.predecessors.get(lotId) ?? [],
      lotDismissalFacts,
    )
    if (part?.choice.mode === 'create') {
      try {
        validatePartSpec(part.choice.spec, snapshot.target_context_id, snapshot.observations)
      } catch (error) {
        if (!(error instanceof PartSpecError)) {
          throw error
        }
        issues.push(
          issue(
            error.code,
            'Mapped category, parameter or company observations are incompatible.',
            lotId,
          ),
        )
      }
      newParts.set(part.id, part.choice.spec)
      if (quantity.mode === 'set' && draftLocation?.parentValid) {
        usedLocationDrafts.set(draftLocation.location.draftId, draftLocation.location)
        effects.push({
          lot_id: lotId,
          lot_label: lot.label,
          part_id: null,
          part_operation_key: logicalEffectKey(part.id, 'create_part'),
          part_label: part.choice.spec.name,
          quantity: quantity.value,
          location_id: null,
          location_label: draftLocation.label,
          location_operation_key: locationCreateKey(draftLocation.location.draftId),
          contribution_key: lot.contribution_key,
          barcode: contributionBarcode(snapshot.source_id, lot.contribution_key),
        })
      } else if (
        quantity.mode === 'set' &&
        (location.mode === 'set' || location.mode === 'clear')
      ) {
        const ref = location.mode === 'set' ? location.value : null
        const observed = ref
          ? snapshot.observations.find((item) => item.id === ref.observation_id)
          : null
        if (
          ref &&
          (!observed ||
            observed.model !== 'location' ||
            observed.pk !== ref.pk ||
            ref.target_context_id !== snapshot.target_context_id)
        ) {
          issues.push(
            issue(
              'observation_binding_invalid',
              'The location observation is incompatible.',
              lotId,
            ),
          )
        } else {
          effects.push({
            lot_id: lotId,
            lot_label: lot.label,
            part_id: null,
            part_operation_key: logicalEffectKey(part.id, 'create_part'),
            part_label: part.choice.spec.name,
            quantity: quantity.value,
            location_id: ref?.pk ?? null,
            location_label: observed?.label ?? 'No location',
            contribution_key: lot.contribution_key,
            barcode: contributionBarcode(snapshot.source_id, lot.contribution_key),
          })
        }
      }
    }
    if (part?.choice.mode === 'set' && quantity.mode === 'set' && draftLocation?.parentValid) {
      const partRef = part.choice.value
      const partObservation = snapshot.observations.find(
        (value) => value.id === partRef.observation_id,
      )
      if (
        !partObservation ||
        partObservation.model !== 'part' ||
        partObservation.pk !== partRef.pk ||
        partObservation.target_context_id !== snapshot.target_context_id ||
        partRef.target_context_id !== snapshot.target_context_id ||
        partRef.model !== 'part'
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
      usedLocationDrafts.set(draftLocation.location.draftId, draftLocation.location)
      effects.push({
        lot_id: lotId,
        lot_label: lot.label,
        part_id: partRef.pk,
        part_label: partObservation.label,
        quantity: quantity.value,
        location_id: null,
        location_label: draftLocation.label,
        location_operation_key: locationCreateKey(draftLocation.location.draftId),
        contribution_key: lot.contribution_key,
        barcode: contributionBarcode(snapshot.source_id, lot.contribution_key),
      })
    } else if (
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
  const locations = [...usedLocationDrafts.values()]
  const company = effects.length ? supplier : null
  const companies = company ? [company] : []
  // Record drafts are bound only when present, so legacy selection bytes are unchanged.
  const records = locations.length || companies.length ? { locations, companies } : null
  const bytes = Buffer.from(
    canonical({
      version: records
        ? 'manual-selection/3'
        : mediaDigests.size
          ? 'manual-selection/2'
          : 'manual-selection/1',
      batchId: snapshot.id,
      sourceId: snapshot.source_id,
      selected,
      subjects: retainedSubjects.map((value) => ({
        subjectId: value.subjectId,
        digest: value.digest.toString('hex'),
      })),
      effects,
      ...(records ? { records } : {}),
    }),
  )
  return {
    selected,
    partDestinations,
    parts: [...newParts.entries()].map(([subjectId, spec]) => ({ subjectId, spec })),
    ...(records ?? {}),
    effects,
    subjects: retainedSubjects,
    issues,
    warnings: [...warnings.values()],
    bytes,
    digest: sha256(bytes),
  }
}

/** Warnings without a current dismissal; they block marking the scope reviewed. */
export function unresolvedWarnings(material: ManualMaterial): ReviewWarning[] {
  return material.warnings.filter((warning) => warning.disposition === null)
}
