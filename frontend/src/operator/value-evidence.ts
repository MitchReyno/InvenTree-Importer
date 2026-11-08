import type { CaptureSnapshotDto, SourceAgreementDto, SourceKindDto } from '@invimport/contracts'
import type { SourceTone } from '../components/ui/SourceChip'

const KIND_WORDS: Record<SourceKindDto, string> = {
  label: 'Label',
  packing_slip: 'Packing slip',
  handwriting: 'Handwriting',
  distributor_page: 'Distributor page',
}

const AGREEMENT: Record<SourceAgreementDto, { certainty: string; tone: SourceTone }> = {
  read: { certainty: 'Read', tone: 'default' },
  likely: { certainty: 'Likely', tone: 'likely' },
  disagree: { certainty: 'Sources disagree', tone: 'conflict' },
}

/** A value's source kind and agreement in words, so uncertainty reads without a score. */
export function evidenceWords(said: {
  source_kind?: SourceKindDto
  agreement?: SourceAgreementDto
}): {
  kind?: string
  certainty?: string
  tone: SourceTone
} {
  return {
    ...(said.source_kind ? { kind: KIND_WORDS[said.source_kind] } : {}),
    ...(said.agreement ? { certainty: AGREEMENT[said.agreement].certainty } : {}),
    tone: said.agreement ? AGREEMENT[said.agreement].tone : 'default',
  }
}

type Observation = NonNullable<CaptureSnapshotDto['evidence_observations']>[number]

/** Who a reading comes from: the Examine step, in words when it said, or the operator. */
export function readingSource(observation: Observation) {
  if (observation.origin === 'operator' || observation.operator_edited) {
    return { source: 'You', certainty: 'Your edit', tone: 'user' as const }
  }
  const said = evidenceWords(observation.readings)
  return {
    source: said.kind ? `Examine · ${said.kind}` : 'Examine',
    // Line regions are a document's lines; pixel regions are part of a photo.
    certainty:
      said.certainty ??
      (observation.region.kind === 'lines' ? 'Read from the document' : 'Read from the photo'),
    tone: said.tone,
  }
}
