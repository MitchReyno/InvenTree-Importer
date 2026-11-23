import styled from 'styled-components'
import { color, radius, space } from '#/theme/generated/tokens'
import { raisedOnField, Skeleton } from '#/components/ui'

/** Ready to add and Added in skeleton blocks, until their read lands: the heading, then the plan. */
export function ChangesSkeleton() {
  return (
    <Column>
      <Skeleton width="25%" height={space[9]} />
      <Card>
        <Skeleton width="35%" height={space[8]} />
        {ROWS.map((row) => (
          <Skeleton key={row} width="100%" height={space[10]} />
        ))}
      </Card>
    </Column>
  )
}

const ROWS = ['first', 'second', 'third']

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
