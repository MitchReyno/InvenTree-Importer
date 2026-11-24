import styled from 'styled-components'
import { color, radius, space } from '#/theme/generated/tokens'
import { raisedOnField, Skeleton } from '#/components/ui'

/** A page's heading and first card in skeleton blocks, until bootstrap says what to show. */
export function AppSkeleton() {
  return (
    <Column>
      <Skeleton width="30%" height={space[10]} />
      <Card>
        <Skeleton width="40%" height={space[8]} />
        <Skeleton width="100%" height={space[12]} />
        <Skeleton width="100%" height={space[12]} />
      </Card>
    </Column>
  )
}

const Column = styled.div`
  display: grid;
  gap: ${space[7]};
`

const Card = styled.div`
  display: grid;
  gap: ${space[4]};
  padding: ${space[7]};
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
  ${raisedOnField}
`
