import styled from 'styled-components'
import { color, radius, space } from '#/theme/generated/tokens'
import { media, Skeleton } from '#/components/ui'

/** Review's layout in skeleton blocks, until its first read lands: the scope bar, then the grid. */
export function ReviewSkeleton() {
  return (
    <Column>
      <Block>
        <Skeleton width="30%" height={space[7]} />
      </Block>
      <Grid>
        <Block>
          {ROWS.map((row) => (
            <Skeleton key={row} width="100%" height={space[10]} />
          ))}
        </Block>
        <Block>
          <Skeleton width="40%" height={space[8]} />
          <Skeleton width="100%" height={space[20]} />
          <Skeleton width="70%" height={space[6]} />
        </Block>
      </Grid>
    </Column>
  )
}

const ROWS = ['first', 'second', 'third', 'fourth']

const Column = styled.div`
  display: grid;
  gap: ${space[7]};
`

const Grid = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
  gap: ${space[7]};
  ${media.compact} {
    grid-template-columns: minmax(0, 1fr);
  }
`

const Block = styled.div`
  display: grid;
  gap: ${space[4]};
  align-content: start;
  padding: ${space[7]};
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
`
