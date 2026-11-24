import styled from 'styled-components'
import { color, space } from '#/theme/generated/tokens'
import { Skeleton } from '#/components/ui'

/** The batch list's rows in skeleton blocks, until the batches are read. */
export function BatchesSkeleton() {
  return (
    <Rows>
      {ROWS.map((row) => (
        <Row key={row}>
          <Skeleton width={space[20]} height={space[20]} />
          <Text>
            <Skeleton width="40%" height={space[7]} />
            <Skeleton width="65%" height={space[5]} />
          </Text>
        </Row>
      ))}
    </Rows>
  )
}

const ROWS = ['first', 'second', 'third']

const Rows = styled.div`
  display: grid;
`

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: ${space[6]};
  padding: ${space[6]} ${space[8]};
  & + & {
    border-top: 1px solid ${color.line};
  }
`

const Text = styled.div`
  display: grid;
  flex: 1;
  gap: ${space[3]};
`
