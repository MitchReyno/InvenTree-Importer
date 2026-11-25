import type { RefObject } from 'react'
import styled from 'styled-components'
import type { SessionHistoryBriefDto } from '@invimport/contracts'
import { Button } from '#/components/ui'
import { color, space } from '#/theme/generated/tokens'
import { BriefContent } from './BriefContent'

/** An opened brief: its entries once read, a failed read with its retry, or the read under way. */
export function BriefBody({
  brief,
  failed,
  retrying,
  retry,
  retryButton,
}: {
  /** The brief as this opening of the card read it. */
  brief: SessionHistoryBriefDto | undefined
  failed: boolean
  /** The operator's retry is in flight; its button stays so their focus isn't lost. */
  retrying: boolean
  retry: () => void
  retryButton: RefObject<HTMLButtonElement | null>
}) {
  if (brief) {
    return <BriefContent item={brief} />
  }
  if (failed || retrying) {
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
