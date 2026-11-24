import styled from 'styled-components'
import type { SessionFailureSummaryDto } from '@invimport/contracts'
import { EventTime } from '#/components/ui'
import { failureHeadline } from '#/agents/session-list'
import { color, space, typeVar } from '#/theme/generated/tokens'

/**
 * A failure in one line: its recorded cause in plain words, then its last status line and when
 * it was posted, or when the failure was recorded.
 */
export function FailureLine({ failure }: { failure?: SessionFailureSummaryDto }) {
  const status = failure?.last_status
  const at = status?.at ?? failure?.failed_at
  return (
    <Line>
      <strong>{failureHeadline(failure)}</strong>
      {(status || at) && (
        <When>
          {status && <span>Last status: {status.text}</span>}
          {at && <EventTime at={at} />}
        </When>
      )}
    </Line>
  )
}

const Line = styled.span`
  display: grid;
  gap: ${space[1]};
  min-width: 0;
`

const When = styled.span`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[1]} ${space[3]};
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`
