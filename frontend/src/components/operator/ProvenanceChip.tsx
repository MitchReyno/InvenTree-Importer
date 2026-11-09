import { PROVENANCE_LABELS, type Provenance } from '#/operator/review-model'
import { SourceChip, type SourceTone } from '#/components/ui'

/** Where each provenance comes from, its tone and one sentence on why; certainty defaults to its label. */
const PROVENANCE_SOURCE: Record<
  Provenance,
  { source: string; certainty?: string; tone: SourceTone; why: string }
> = {
  human: {
    source: 'You',
    certainty: 'Your edit',
    tone: 'user',
    why: 'You set this value on the lot.',
  },
  override: {
    source: 'You',
    certainty: 'Your edit',
    tone: 'user',
    why: 'You set this lot to differ from the batch default.',
  },
  inherited: {
    source: 'Batch default',
    tone: 'default',
    why: 'Taken from the batch settings in Capture.',
  },
  unknown: {
    source: 'Unknown',
    certainty: 'Not known',
    tone: 'likely',
    why: 'Where this value came from is not known.',
  },
  cleared: { source: 'You', tone: 'user', why: 'You cleared this value.' },
  unset: {
    source: 'Not set',
    certainty: 'Needs a value',
    tone: 'likely',
    why: 'Nothing has set this value yet.',
  },
  shared_part: {
    source: 'Shared Part',
    tone: 'default',
    why: 'Taken from the shared Part proposal this lot uses.',
  },
  evidence_group: {
    source: 'Evidence group',
    tone: 'default',
    why: 'Taken from the evidence group this lot’s evidence is in.',
  },
  conflict: {
    source: 'Evidence groups',
    tone: 'conflict',
    why: 'This lot’s evidence groups give different values.',
  },
  unconfirmed: {
    source: 'Evidence groups',
    tone: 'likely',
    why: 'The evidence groups could not be read, so the value is not confirmed.',
  },
}

type ProvenanceChipProps = {
  provenance: Provenance
  /** The value's label and text, for the chip's details. */
  field: string
  value: string
}

/** Where a lot's value came from, as a short source chip with its provenance in the details. */
export function ProvenanceChip({ provenance, field, value }: ProvenanceChipProps) {
  const { source, certainty, tone, why } = PROVENANCE_SOURCE[provenance]

  return (
    <SourceChip
      source={source}
      certainty={certainty ?? PROVENANCE_LABELS[provenance]}
      tone={tone}
      field={field}
      value={value}
      why={why}
    />
  )
}
