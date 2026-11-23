import styled from 'styled-components'
import { space } from '#/theme/generated/tokens'
import { Skeleton } from '#/components/ui'
import type { ProcessingView } from '#/processing/types'
import { Card } from './ProcessingParts'

/** Processing's layout in skeleton blocks, until its first read lands. */
export function ProcessingSkeleton({ view }: { view: ProcessingView }) {
  if (view !== 'overview') {
    return (
      <Column>
        <Card as="div">
          <Skeleton width="45%" height={space[9]} />
          <Skeleton width="100%" height={space[5]} />
        </Card>
        <Card as="div">
          <Skeleton width="30%" height={space[8]} />
          <Skeleton width="100%" height={space[12]} />
          <Skeleton width="100%" height={space[12]} />
        </Card>
      </Column>
    )
  }

  return (
    <Column>
      <Card as="div">
        <Skeleton width="35%" height={space[9]} />
        <Skeleton width="100%" height={space[5]} />
        <Skeleton width="70%" height={space[6]} />
        <Skeleton width="100%" height={space[12]} />
      </Card>
      <Card as="div">
        <Skeleton width="25%" height={space[8]} />
        <Skeleton width="100%" height={space[10]} />
      </Card>
      <Card as="div">
        <Skeleton width="30%" height={space[8]} />
        <Skeleton width="80%" height={space[6]} />
        <Skeleton width="60%" height={space[6]} />
      </Card>
    </Column>
  )
}

const Column = styled.div`
  display: grid;
  gap: ${space[7]};
`
