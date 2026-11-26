import {
  VOCABULARY_KINDS,
  type BriefVocabularyEntryDto,
  type CaptureObservationDto,
  type VocabularyKindDto,
} from '@invimport/contracts'

const KINDS: ReadonlySet<string> = new Set(VOCABULARY_KINDS)

function isVocabularyKind(model: string): model is VocabularyKindDto {
  return KINDS.has(model)
}

function compareText(left: string, right: string) {
  if (left === right) {
    return 0
  }
  return left < right ? -1 : 1
}

/**
 * The batch's catalogue vocabulary: its retained category, parameter template, category mapping
 * and company observations in the current target context, each with the reference a proposal
 * cites. Ordered by kind, then label, then observation, so pages are stable. A Part or location
 * observation is not vocabulary, and one from an earlier target context can't be cited.
 */
export function catalogueVocabulary(
  observations: readonly CaptureObservationDto[],
  targetContextId: string,
): BriefVocabularyEntryDto[] {
  const entries: BriefVocabularyEntryDto[] = []
  for (const observation of observations) {
    if (!isVocabularyKind(observation.model)) {
      continue
    }
    if (observation.target_context_id !== targetContextId) {
      continue
    }
    entries.push({
      kind: 'vocabulary',
      reference: {
        observation_id: observation.id,
        target_context_id: observation.target_context_id,
        model: observation.model,
        pk: observation.pk,
      },
      label: observation.label,
      ...(observation.mapping ? { mapping: observation.mapping } : {}),
    })
  }
  return entries.sort(
    (left, right) =>
      VOCABULARY_KINDS.indexOf(left.reference.model) -
        VOCABULARY_KINDS.indexOf(right.reference.model) ||
      compareText(left.label, right.label) ||
      compareText(left.reference.observation_id, right.reference.observation_id),
  )
}
