import styled from 'styled-components'
import { space } from '#/theme/generated/tokens'
import { Panel, Skeleton } from '#/components/ui'

/** Images' gallery in skeleton blocks, until the retained media is read. */
export function ProcessingImagesSkeleton() {
  return (
    <Gallery>
      {CARDS.map((card) => (
        <Panel key={card} as="div">
          <Skeleton width="50%" height={space[8]} />
          <Skeleton width="100%" height={space[20]} />
          <Skeleton width="70%" height={space[6]} />
        </Panel>
      ))}
    </Gallery>
  )
}

const CARDS = ['first', 'second']

const Gallery = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 360px), 1fr));
  gap: ${space[8]};
  margin-top: ${space[7]};
`
