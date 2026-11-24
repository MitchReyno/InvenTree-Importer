import styled from 'styled-components'
import { color, space, type } from '#/theme/generated/tokens'
import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { SessionFailureDto, SessionFailureSummaryDto } from '@invimport/contracts'
import { serverQueryKey } from '#/queries/scope'
import { Button, DebugDetails, Link, Spinner } from '#/components/ui'
import { useServerScope } from '#/context'
import { useDebugMode } from '#/debug/debug-mode'

export type FailureLoader = (attemptId: string, failureId: string) => Promise<SessionFailureDto>
const labels: Record<SessionFailureDto['category'], string> = {
  authentication: 'Authentication',
  configuration: 'Configuration',
  tool_policy: 'Tool policy',
  validation: 'Validation',
  evidence: 'Evidence',
  provider_network: 'Provider / network',
  timeout: 'Timeout',
  interrupted: 'Interrupted',
  internal: 'Internal / unknown',
}

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

export const FAILED_SESSION_STATES = new Set([
  'failed',
  'interrupted',
  'resume_unavailable',
  'waiting_for_login',
])

/**
 * Category, summary and recovery always show. In debug mode, Show details reads the retained
 * diagnostics on demand; expanding only reads, and never sends chat or retries work.
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
      <p>
        <strong>{failure ? labels[failure.category] : 'Category unavailable'}</strong>
        {failure && `: ${failure.summary}`}
      </p>
      {failure && <p>{failure.recovery}</p>}
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
