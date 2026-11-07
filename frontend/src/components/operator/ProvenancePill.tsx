import { PROVENANCE_LABELS, type Provenance } from '../../operator/review-model'
import { Pill, type PillTone } from '../ui/Pill'

const PROVENANCE_TONES: Record<Provenance, PillTone> = {
  human: 'acc',
  override: 'acc',
  inherited: 'neutral',
  unknown: 'warn',
  cleared: 'neutral',
  unset: 'warn',
  shared_part: 'neutral',
  evidence_group: 'neutral',
  conflict: 'warn',
  unconfirmed: 'warn',
}

/** Where a lot's value came from, in words. */
export function ProvenancePill({ provenance }: { provenance: Provenance }) {
  return <Pill tone={PROVENANCE_TONES[provenance]}>{PROVENANCE_LABELS[provenance]}</Pill>
}
