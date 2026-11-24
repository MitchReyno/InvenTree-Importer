import styled from 'styled-components'
import { color, radius, space } from '#/theme/generated/tokens'
import { media, raisedOnField, Skeleton } from '#/components/ui'

/** Capture's layout in skeleton blocks, until the batch is read: batch settings, then evidence. */
export function CaptureSkeleton() {
  return (
    <Grid>
      <Card>
        <Skeleton width="40%" height={space[8]} />
        <Skeleton width="100%" height={space[10]} />
        <Skeleton width="100%" height={space[10]} />
      </Card>
      <Card>
        <Skeleton width="30%" height={space[8]} />
        <Skeleton width="100%" height={space[20]} />
        <Skeleton width="60%" height={space[6]} />
      </Card>
    </Grid>
  )
}

const Grid = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
  gap: ${space[7]};
  ${media.compact} {
    grid-template-columns: minmax(0, 1fr);
  }
`

const Card = styled.div`
  display: grid;
  gap: ${space[4]};
  align-content: start;
  padding: ${space[7]};
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
  ${raisedOnField}
`
