import styled from 'styled-components'
import { space } from '#/theme/generated/tokens'
import { Skeleton } from '#/components/ui'

/** A session's steps and chat in skeleton blocks, until its history is read. */
export function SessionSkeleton() {
  return (
    <Column>
      {STEPS.map((step) => (
        <Skeleton key={step} width="100%" height={space[8]} />
      ))}
      <Skeleton width="100%" height={space[20]} />
    </Column>
  )
}

const STEPS = ['first', 'second', 'third']

const Column = styled.div`
  display: grid;
  gap: ${space[4]};
`
