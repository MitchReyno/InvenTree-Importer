import type { RefObject } from 'react'
import styled from 'styled-components'
import type { UseQueryResult } from '@tanstack/react-query'
import type { SessionHistoryBriefDto } from '@invimport/contracts'
import { Button, Small } from '#/components/ui'
import { color, space } from '#/theme/generated/tokens'
import { BriefContent } from './BriefContent'

/**
 * An opened brief: its entries once read, a failed read with its retry, or the read under way.
 * A failed read again keeps the copy read earlier and says so.
 */
export function BriefBody({
  query,
  retrying,
  retry,
  retryButton,
}: {
  query: UseQueryResult<SessionHistoryBriefDto>
  /** The operator's retry is in flight; its button stays so their focus isn't lost. */
  retrying: boolean
  retry: () => void
  retryButton: RefObject<HTMLButtonElement | null>
}) {
  if (query.data) {
    return (
      <>
        {query.isRefetchError && (
          <Note role="status">
            <Small>Couldn’t read this brief again; showing the copy read earlier.</Small>
          </Note>
        )}
        <BriefContent item={query.data} />
      </>
    )
  }
  if (query.isError || retrying) {
    return (
      <Note role="alert">
        The brief this attempt started from couldn’t be read.{' '}
        <Button
          ref={retryButton}
          size="sm"
          aria-disabled={retrying || undefined}
          onClick={retrying ? undefined : retry}
        >
          {retrying ? 'Trying again…' : 'Try again'}
        </Button>
      </Note>
    )
  }
  return <Note role="status">Reading the brief…</Note>
}

const Note = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[2]} ${space[3]};
  padding: ${space[3]} ${space[4]};
  border-top: 1px solid ${color.line};
  color: ${color.muted};
`
