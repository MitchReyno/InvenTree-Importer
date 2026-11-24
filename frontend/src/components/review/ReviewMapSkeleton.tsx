import { space } from '#/theme/generated/tokens'
import { Skeleton } from '#/components/ui'

/** A Map column's cards in skeleton blocks, until the evidence is read. */
export function ReviewMapSkeleton() {
  return (
    <>
      <Skeleton width="25%" height={space[6]} />
      {CARDS.map((card) => (
        <Skeleton key={card} width="100%" height={space[20]} />
      ))}
    </>
  )
}

const CARDS = ['first', 'second', 'third']
