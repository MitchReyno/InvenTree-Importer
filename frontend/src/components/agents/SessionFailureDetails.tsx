import styled from 'styled-components'
import { color, space, radius, type } from '../../theme/generated/tokens'
import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { SessionFailureDto, SessionFailureSummaryDto } from '@invimport/contracts'
import { serverQueryKey, useServerScope } from '../../queries/scope'
import { Button } from '../ui/Button'

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
export const FAILED_SESSION_STATES = new Set([
  'failed',
  'interrupted',
  'resume_unavailable',
  'waiting_for_login',
])

/** Expanding retained diagnostics only reads; it never sends chat or retries work. */
export function SessionFailureDetails({
  attemptId,
  failure,
  load,
}: {
  attemptId: string
  failure?: SessionFailureSummaryDto
  load?: FailureLoader
}) {
  const [expanded, setExpanded] = useState(false)
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
    enabled: expanded && Boolean(load && failure?.details_available),
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
      <Button
        variant="ghost"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? 'Hide details' : 'Show details'}
      </Button>
      {expanded && (
        <div id={id} role="region" aria-label="Failure details">
          {!available && <p>Details were not retained for this session.</p>}
          {available && query.isError && (
            <p role="status">Failure details are currently unavailable.</p>
          )}
          {available && !query.isError && !details && <p role="status">Loading failure details…</p>}
          {available && !query.isError && details && (
            <>
              <p>{details.recovery}</p>
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
    box-sizing: border-box;
    padding: ${space[3]};
    border: 1px solid ${color.line};
    border-radius: ${radius.card};
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
