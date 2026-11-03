import styled from 'styled-components'
import type { Snapshot } from '../../capture/types'
import { captureContext, contextDescription } from '../../capture/context'
import { Paragraph, Small } from '../ui/primitives'

type Props = { batch: Snapshot; subjectId?: string }

export function CaptureContextSummary({ batch, subjectId }: Props) {
  const record = batch.context?.find((item) => item.subject_id === (subjectId ?? null))
  const context = captureContext(batch, subjectId ?? null)
  return (
    <Context aria-label="Human capture context">
      <Small>Human capture context · separate from approved inventory effects</Small>
      {(['supplier', 'purchase_date', 'tags'] as const).map((field) => (
        <Paragraph key={field}>
          {{ supplier: 'Supplier', purchase_date: 'Purchase date', tags: 'Capture tags' }[field]}:{' '}
          {subjectId && context[field].mode !== 'inherit' ? 'Override · ' : ''}
          {contextDescription(batch, subjectId ?? null, field)}
        </Paragraph>
      ))}
      {record && (
        <Small>
          Human record {record.id} · version {record.version} · actor {record.actor_id}
        </Small>
      )}
    </Context>
  )
}

const Context = styled.div`
  min-width: 0;
  overflow-wrap: anywhere;
`
