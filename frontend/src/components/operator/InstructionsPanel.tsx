import { useCallback, useEffect } from 'react'
import styled from 'styled-components'
import type { CaptureSnapshotDto, OperatorReviewDto } from '@invimport/contracts'
import type { OperatorReviewClient } from '../../operator/types'
import { Small, Subheading } from '../ui/primitives'
import { InstructionForm } from './InstructionForm'

interface Props {
  batch: CaptureSnapshotDto
  review: OperatorReviewDto
  client: OperatorReviewClient
  disabled: boolean
  reload: () => Promise<void>
  onDirtyChange: (dirty: boolean) => void
}

/** Batch instructions share settings; group instructions stay in their evidence group. */
export function InstructionsPanel({
  batch,
  review,
  client,
  disabled,
  reload,
  onDirtyChange,
}: Props) {
  const reportDirty = useCallback(
    (_key: string, dirty: boolean) => onDirtyChange(dirty),
    [onDirtyChange],
  )
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])
  return (
    <Section aria-label="Instructions">
      <Subheading>Instructions</Subheading>
      <Small>
        Versioned human context for research. Instructions do not approve inventory values or create
        stock.
      </Small>
      <InstructionForm
        batch={batch}
        review={review}
        client={client}
        groupId={null}
        label="Batch instructions"
        disabled={disabled}
        reload={reload}
        onDirtyChange={reportDirty}
      />
    </Section>
  )
}

const Section = styled.section`
  display: grid;
  gap: 14px;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid #e3e8ef;
`
