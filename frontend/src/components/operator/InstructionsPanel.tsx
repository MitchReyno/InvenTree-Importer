import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import styled from 'styled-components'
import type { CaptureSnapshotDto, OperatorReviewDto } from '@invimport/contracts'
import type { MediaClient } from '../../media/types'
import type { OperatorReviewClient } from '../../operator/types'
import { serverQueryKey, useServerScope } from '../../queries/scope'
import { useRetainedPollInterval } from '../operations/LiveUpdates'
import { Small, Subheading } from '../ui/primitives'

import { InstructionForm } from './InstructionForm'

interface Props {
  batch: CaptureSnapshotDto
  review: OperatorReviewDto
  client: OperatorReviewClient
  includeGroups?: boolean
  media?: MediaClient
  disabled: boolean
  reload: () => Promise<void>
  onDirtyChange: (dirty: boolean) => void
}

/** Versioned human instructions for the batch and each evidence group. */
export function InstructionsPanel({
  batch,
  review,
  client,
  media,
  includeGroups = true,
  disabled,
  reload,
  onDirtyChange,
}: Props) {
  const pollInterval = useRetainedPollInterval()
  const scope = useServerScope()
  const mediaQuery = useQuery({
    queryKey: serverQueryKey(scope, 'media', batch.id),
    queryFn: () => media!.snapshot(batch.id),
    enabled: includeGroups && media !== undefined,
    refetchInterval: pollInterval,
  })
  const dirtyForms = useRef(new Set<string>())
  const [, setVersion] = useState(0)

  const reportDirty = useCallback(
    (key: string, dirty: boolean) => {
      const before = dirtyForms.current.size
      if (dirty) {
        dirtyForms.current.add(key)
      } else {
        dirtyForms.current.delete(key)
      }
      if (before !== dirtyForms.current.size) {
        setVersion((value) => value + 1)
        onDirtyChange(dirtyForms.current.size > 0)
      }
    },
    [onDirtyChange],
  )

  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  const groups = includeGroups ? (mediaQuery.data?.groups ?? []) : []
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
        disabled={disabled || (dirtyForms.current.size > 0 && !dirtyForms.current.has('batch'))}
        reload={reload}
        onDirtyChange={reportDirty}
      />
      {groups.map((group) => (
        <InstructionForm
          key={group.id}
          batch={batch}
          review={review}
          client={client}
          groupId={group.id}
          label={`Group “${group.label}”`}
          disabled={disabled || (dirtyForms.current.size > 0 && !dirtyForms.current.has(group.id))}
          reload={reload}
          onDirtyChange={reportDirty}
        />
      ))}
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
