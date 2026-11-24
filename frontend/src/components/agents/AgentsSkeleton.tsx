import styled from 'styled-components'
import { color, radius, space } from '#/theme/generated/tokens'
import { raisedOnField, Skeleton } from '#/components/ui'

/** The Agents page in skeleton blocks, until its first read lands: the summary, then a batch. */
export function AgentsSkeleton() {
  return (
    <>
      <Card>
        <Row>
          <Skeleton width="20%" height={space[9]} />
          <Skeleton width="25%" height={space[9]} />
          <Skeleton width="15%" height={space[9]} />
        </Row>
      </Card>
      <Skeleton width="40%" height={space[8]} />
      <Card>
        <Skeleton width="30%" height={space[7]} />
        {ROWS.map((row) => (
          <Skeleton key={row} width="100%" height={space[8]} />
        ))}
      </Card>
    </>
  )
}

const ROWS = ['first', 'second', 'third']

const Card = styled.div`
  display: grid;
  gap: ${space[4]};
  padding: ${space[6]} ${space[8]};
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
  ${raisedOnField}
`

const Row = styled.div`
  display: flex;
  gap: ${space[9]};
`
