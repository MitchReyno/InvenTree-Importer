import styled from 'styled-components'
import { Button, Small } from '#/components/ui'
import { space } from '#/theme/generated/tokens'

/** Load more for a session list read a page at a time. */
export type MoreSessions = {
  canLoadMore: boolean
  loadingMore: boolean
  moreFailed: boolean
  loadedMore?: boolean
  loadMore: () => void
  retryMore: () => void
}

/**
 * Stays in place while the next page loads, so focus stays on it, and offers to read a page that
 * failed again from the same place.
 */
export function LoadMore({ more }: { more: MoreSessions }) {
  const done = !more.canLoadMore && !more.loadingMore && !more.moreFailed
  if (done && !more.loadedMore) {
    return null
  }
  // One button throughout, so focus stays on it from a press to the page landing or failing.
  return (
    <Paging aria-label="Session pages">
      <Button
        size="sm"
        busy={more.loadingMore}
        reasonDisplay="quiet"
        // Once every page is in, the button stays where focus was and says so.
        disabledReason={done ? 'Every session is loaded.' : undefined}
        onClick={more.moreFailed ? more.retryMore : more.loadMore}
      >
        {more.moreFailed ? 'Try loading more again' : 'Load more'}
      </Button>
      {more.moreFailed && (
        <Small role="alert">
          More sessions couldn’t be read; those shown from it may be out of date.
        </Small>
      )}
    </Paging>
  )
}

const Paging = styled.nav`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[4]};
`
