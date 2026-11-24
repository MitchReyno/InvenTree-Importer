import styled from 'styled-components'
import { color, radius, space } from '#/theme/generated/tokens'
import { media, raisedOnField, Skeleton } from '#/components/ui'

/** Records' layout in skeleton blocks, until the records are read: the heading, rail, list and record. */
export function RecordsSkeleton() {
  return (
    <>
      <Skeleton width="40%" height={space[9]} />
      <Layout>
        <Column>
          {TYPES.map((row) => (
            <Skeleton key={row} width="100%" height={space[10]} />
          ))}
        </Column>
        <Column>
          {ROWS.map((row) => (
            <Skeleton key={row} width="100%" height={space[10]} />
          ))}
        </Column>
        <Column>
          <Skeleton width="50%" height={space[8]} />
          <Skeleton width="100%" height={space[20]} />
        </Column>
      </Layout>
    </>
  )
}

const TYPES = ['parts', 'stock', 'locations', 'companies']
const ROWS = ['first', 'second', 'third']

/** The same columns as the Records page. */
const Layout = styled.div`
  display: grid;
  grid-template-columns: minmax(200px, 240px) minmax(220px, 320px) minmax(0, 1fr);
  gap: ${space[6]};
  align-items: start;
  ${media.stacked} {
    grid-template-columns: 1fr;
  }
`

const Column = styled.div`
  display: grid;
  gap: ${space[2]};
  padding: ${space[4]};
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
  ${raisedOnField}
`
