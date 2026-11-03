import type { HeaderWorkDto } from '@invimport/contracts'
import { Link, Paragraph, Small, Subheading } from '../ui/primitives'
import styled from 'styled-components'

interface Props {
  data?: HeaderWorkDto
  batchId?: string
  unavailable: boolean
  fresh: boolean
}

export function WorkflowDetails({ data, batchId, unavailable, fresh }: Props) {
  const current = data?.work.filter((item) => item.batch_id === batchId) ?? []
  const others = data?.work.filter((item) => item.batch_id !== batchId) ?? []
  return (
    <>
      <Paragraph>
        Application-wide retained work{batchId ? ' · current batch shown first' : ''}. These
        controls navigate to the owning views.
      </Paragraph>
      {unavailable && (
        <Paragraph role="alert">
          Workflow read unavailable. Last retained details, if shown, cannot establish current idle
          or released capacity.
        </Paragraph>
      )}
      {data && !fresh && <Paragraph role="status">This workflow observation is stale.</Paragraph>}
      <Small>
        Last work read: {data ? new Date(data.observed_at).toLocaleString() : 'Not yet observed'}
      </Small>
      {data?.work_truncated && (
        <Paragraph>
          Work coverage is partial. Open the owning views for additional retained work.
        </Paragraph>
      )}
      {[...current, ...others].map((item) => (
        <Work key={`${item.kind}:${item.id}`}>
          <Subheading>
            {item.batch_id === batchId ? 'Current batch' : 'Other batch'} ·{' '}
            {item.kind === 'processing' ? 'Processing' : 'Import'}
          </Subheading>
          <Paragraph>
            {item.stage} · {item.state.replaceAll('_', ' ')}
          </Paragraph>
          <Small>
            Batch {item.batch_id} ·{' '}
            {item.kind === 'processing' ? `attempt ${item.attempt_id}` : `run ${item.id}`}
          </Small>
          {item.kind === 'processing' && (
            <Paragraph>
              {item.occupies_lane
                ? 'Physical lane occupied'
                : 'No physical occupancy reported for this attempt'}{' '}
              ·{' '}
              {item.input_current === null
                ? 'Input currency unknown'
                : item.input_current
                  ? 'Retained input current'
                  : 'Retained input stale'}
              {item.blocked_code ? ` · ${item.blocked_code.replaceAll('_', ' ')}` : ''}
            </Paragraph>
          )}
          <ol aria-label="Retained steps">
            {item.steps.map((step, index) => (
              <li key={index}>
                {'stage' in step ? step.stage : step.name} · {step.state.replaceAll('_', ' ')}
              </li>
            ))}
          </ol>
          {!item.steps_complete && (
            <Small>Fine-grained step coverage is incomplete. No percentage is inferred.</Small>
          )}
          <Action
            href={
              item.kind === 'processing'
                ? `#${item.batch_id}/processing/overview`
                : `#${item.batch_id}/results/${item.id}`
            }
          >
            {item.kind === 'processing' ? 'Open processing' : 'Open original run'}
          </Action>
        </Work>
      ))}
      {fresh && data && !data.work.length && !data.work_truncated && (
        <Paragraph>No retained work in this observation.</Paragraph>
      )}
      <Subheading>Agent sessions</Subheading>
      {data?.sessions_truncated && (
        <Paragraph>
          Active-session coverage is partial. An empty displayed list does not establish no active
          agents.
        </Paragraph>
      )}
      {data?.active_sessions.map((session) => (
        <Work key={session.attempt_id}>
          <strong>
            {session.selection.provider} ·{' '}
            {session.actual_model
              ? `actual model ${session.actual_model}`
              : `requested model ${session.selection.model}`}
            {!session.actual_model && <Small>Actual model not yet reported.</Small>}
          </strong>
          <Paragraph>
            {session.stage} · logical state {session.state.replaceAll('_', ' ')} ·{' '}
            {session.progress}
          </Paragraph>
          <Paragraph>
            {session.occupies_lane
              ? 'Physical lane occupied'
              : session.progress === 'queued'
                ? 'Queued; physical lane not held by this session'
                : 'No physical occupancy reported'}
          </Paragraph>
          <Small>
            Batch {session.batch_id} · attempt {session.attempt_id}
          </Small>
          <Action href={`#${session.batch_id}/processing/overview`}>Open session work</Action>
        </Work>
      ))}
      {fresh &&
        data &&
        !data.active_sessions.length &&
        !data.sessions_truncated &&
        !data.lane_occupied && <Paragraph>No active agents</Paragraph>}
      {data?.lane_occupied && !data.active_sessions.some((session) => session.occupies_lane) && (
        <Paragraph>
          Processing lane occupied; session details are not available in this authorized projection.
        </Paragraph>
      )}
      <Action href="#agents">Agent sessions</Action>
    </>
  )
}

const Work = styled.section`
  padding: 10px 0;
  border-bottom: 1px solid #d5dce5;
  overflow-wrap: anywhere;
  ol {
    padding-left: 20px;
  }
`
const Action = styled(Link)`
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  margin-right: 10px;
`
