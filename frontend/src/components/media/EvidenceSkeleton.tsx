import styled from 'styled-components'
import { space } from '#/theme/generated/tokens'
import { Skeleton } from '#/components/ui'

/** The evidence groups in skeleton blocks, until the retained media is read. */
export function EvidenceSkeleton() {
  return (
    <Column>
      <Skeleton width="30%" height={space[7]} />
      <Skeleton width="100%" height={space[20]} />
      <Skeleton width="100%" height={space[20]} />
    </Column>
  )
}

const Column = styled.div`
  display: grid;
  gap: ${space[4]};
`
