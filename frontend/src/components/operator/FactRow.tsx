import styled from 'styled-components'
import { color, space } from '../../theme/generated/tokens'
import type { ReactNode } from 'react'
import { PROVENANCE_LABELS, type Provenance } from '../../operator/review-model'
import { StatusChip, type ChipTone } from './StatusChip'

const PROVENANCE_TONES: Record<Provenance, ChipTone> = {
  human: 'blue',
  override: 'blue',
  inherited: 'neutral',
  unknown: 'amber',
  cleared: 'neutral',
  unset: 'amber',
  shared_part: 'neutral',
  evidence_group: 'neutral',
  conflict: 'amber',
  unconfirmed: 'amber',
}

interface Props {
  label: string
  value: ReactNode
  provenance: Provenance
  children?: ReactNode
}

/** Chosen value first, with where it came from; candidates and edits follow. */
export function FactRow({ label, value, provenance, children }: Props) {
  return (
    <Row>
      <dt>{label}</dt>
      <dd>
        <Value>
          <span>{value}</span>
          <StatusChip $tone={PROVENANCE_TONES[provenance]}>
            {PROVENANCE_LABELS[provenance]}
          </StatusChip>
        </Value>
        {children}
      </dd>
    </Row>
  )
}

const Row = styled.div`
  display: grid;
  gap: ${space[3]};
  padding: ${space[5]} 0;
  border-bottom: 1px solid ${color.line};
  dt {
    font-size: 12px;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: ${color.muted};
  }
  dd {
    margin: 0;
    display: grid;
    gap: ${space[4]};
  }
`
const Value = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[4]};
  overflow-wrap: anywhere;
`
