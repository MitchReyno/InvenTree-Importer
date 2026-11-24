import styled from 'styled-components'
import { color, space, type, typeVar } from '#/theme/generated/tokens'
import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { SessionFailureDto, SessionFailureSummaryDto } from '@invimport/contracts'
import { serverQueryKey } from '#/queries/scope'
import { Button, DebugDetails, EventTime, HelpButton, Link, Spinner } from '#/components/ui'
import { useServerScope } from '#/context'
import { useDebugMode } from '#/debug/debug-mode'
import { failureHeadline } from '#/agents/session-list'

export type FailureLoader = (attemptId: string, failureId: string) => Promise<SessionFailureDto>

/** The provider's own error, kind first, then its result type or HTTP status when given. */
function providerErrorText(error: SessionFailureDto['provider_error']) {
  if (!error) {
    return undefined
  }
  const parts = [error.kind]
  if (error.result) {
    parts.push(error.result)
  }
  if (error.http_status !== null) {
    parts.push(`HTTP ${error.http_status}`)
  }
  return parts.join(' · ')
}

/** The codes behind a failure, for debug mode only: category, cause code and provider error. */
function failureCodes(failure: SessionFailureSummaryDto) {
  const codes: string[] = [failure.category]
  if (failure.cause) {
    codes.push(failure.cause.code)
    const error = failure.cause.provider_error
    if (error) {
      codes.push(error.kind)
      if (error.http_status !== null) {
        codes.push(String(error.http_status))
      }
    }
  }
  return codes.join(' · ')
}

export const FAILED_SESSION_STATES = new Set([
  'failed',
  'interrupted',
  'resume_unavailable',
  'waiting_for_login',
])

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

/**
 * A failure's cause in plain words, with the category's advice behind a help button. Codes show
 * only in debug mode, where Show details reads the retained diagnostics on demand; expanding only
 * reads, and never sends chat or retries work.
 */
export function SessionFailureDetails({
  attemptId,
  failure,
  load,
  sessionHref,
}: {
  attemptId: string
  failure?: SessionFailureSummaryDto
  load?: FailureLoader
  /** The session page, where the failure sits in its history; absent on that page itself. */
  sessionHref?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const { enabled: debug } = useDebugMode()
  const id = useId()
  const scope = useServerScope()
  const query = useQuery({
    queryKey: serverQueryKey(
      scope,
      'agent-session-failure',
      attemptId,
      failure?.id ?? 'unavailable',
    ),
    queryFn: () => load!(attemptId, failure!.id),
    enabled: debug && expanded && Boolean(load && failure?.details_available),
    retry: false,
    staleTime: Infinity,
  })
  const details = query.data
  const available = Boolean(load && failure?.details_available)
  return (
    <FailureSection aria-label="Session failure">
      <Lead>
        <FailureLine failure={failure} />
        {failure && <HelpButton label="What to do" explanation={failure.recovery} />}
      </Lead>
      {debug && failure && <Codes>{failureCodes(failure)}</Codes>}
      {sessionHref && <Link href={sessionHref}>Open session</Link>}
      {debug && (
        <Button
          variant="ghost"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Hide details' : 'Show details'}
        </Button>
      )}
      {debug && expanded && (
        <div id={id} role="region" aria-label="Failure details">
          <DebugDetails label="Failure details">
            {!available && <p>Details were not retained for this session.</p>}
            {available && query.isError && (
              <p role="status">Failure details are currently unavailable.</p>
            )}
            {available && !query.isError && !details && (
              // Read only when the operator opens them, so the wait is a spinner, not a skeleton.
              <p role="status">
                <Spinner /> Loading failure details…
              </p>
            )}
            {available && !query.isError && details && (
              <>
                <dl>
                  {Object.entries({
                    Code: details.code,
                    Stage: details.stage,
                    Time: details.timestamp,
                    'Correlation ID': details.correlation_id,
                    Attempt: details.attempt_id,
                    Lineage: details.lineage_id,
                    Turn: details.turn,
                    Provider: details.provider,
                    Model: details.model,
                    'CLI version': details.cli_version,
                    'Provider session': details.provider_session_id,
                    ...(details.provider_error
                      ? { 'Provider error': providerErrorText(details.provider_error) }
                      : {}),
                  }).map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value ?? 'Unavailable'}</dd>
                    </div>
                  ))}
                </dl>
                {details.causes.length > 0 && (
                  <ul>
                    {details.causes.map((cause, index) => (
                      <li key={index}>
                        {cause.code}: {cause.summary}
                      </li>
                    ))}
                  </ul>
                )}
                {details.truncated && <p>Additional cause details were omitted.</p>}
              </>
            )}
          </DebugDetails>
        </div>
      )}
    </FailureSection>
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

const Lead = styled.div`
  display: flex;
  align-items: start;
  gap: ${space[3]};
`

const Codes = styled.code`
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`

const FailureSection = styled.section`
  flex-basis: 100%;
  min-width: 0;
  display: grid;
  justify-items: start;
  gap: ${space[2]};
  overflow-wrap: anywhere;
  p {
    margin: 0;
  }
  > div {
    width: 100%;
  }
  dl {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
    gap: ${space[3]};
    margin-bottom: 0;
  }
  dt {
    ${type.small}
    color: ${color.muted};
  }
  dd {
    margin: ${space[1]} 0 0;
  }
`
