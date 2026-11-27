import styled from 'styled-components'
import { color, radius, space } from '#/theme/generated/tokens'
import { raisedOnField, Skeleton } from '#/components/ui'
import { ReviewMapSkeleton } from './ReviewMapSkeleton'

/** The Map's layout in skeleton blocks, before the batch is read: the title, evidence and lots. */
export function ReviewMapTabSkeleton() {
  return (
    <Column>
      <Skeleton width="30%" height={space[9]} />
      <Columns>
        <Card>
          <ReviewMapSkeleton />
        </Card>
        <Card>
          <ReviewMapSkeleton />
        </Card>
      </Columns>
    </Column>
  )
}

const Column = styled.div`
  display: grid;
  gap: ${space[7]};
`

const Columns = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: ${space[12]};
`

const Card = styled.div`
  display: grid;
  gap: ${space[4]};
  align-content: start;
  padding: ${space[7]} ${space[8]};
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
  ${raisedOnField}
`
