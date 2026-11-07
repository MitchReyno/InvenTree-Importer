import type { BatchAttentionDto, HeaderWorkDto } from '@invimport/contracts'
import styled from 'styled-components'
import { color, size, space, typeVar } from '../../theme/generated/tokens'
import { batchHref } from '../../navigation/batch-route'
import { jobPill, segmentSteps, stateWords } from '../../header/workSegments'
import { media } from '../ui/media'
import { Pill } from '../ui/Pill'
import { Link, Small } from '../ui/primitives'
import { ProgressSegments } from '../ui/ProgressSegments'

type WorkItem = HeaderWorkDto['work'][number]
type Session = HeaderWorkDto['active_sessions'][number]

interface Props {
  data?: HeaderWorkDto
  batchId?: string
  /** The open batch's title and attention read, from the batch screen's cached reads. */
  batchTitle?: string
  attention?: BatchAttentionDto
  unavailable: boolean
  fresh: boolean
}

const SHORT_TIME: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' }

function shortTime(at: string | number) {
  return new Date(at).toLocaleTimeString([], SHORT_TIME)
}

/** Each job leads with what an operator acts on; lanes, coverage and IDs sit in its Details. */
export function ActivityPopover({
  data,
  batchId,
  batchTitle,
  attention,
  unavailable,
  fresh,
}: Props) {
  const work = data?.work ?? []
  const sessions = data?.active_sessions ?? []
  const ordered = [
    ...work.filter((item) => item.batch_id === batchId),
    ...work.filter((item) => item.batch_id !== batchId),
  ]
  const sessionOnly = [...new Set(sessions.map((session) => session.batch_id))].filter(
    (batch) => !work.some((item) => item.batch_id === batch),
  )

  const title = (batch: string) =>
    batch === batchId ? (batchTitle ?? 'Current batch') : 'Other batch'

  const sessionsOf = (batch: string) => sessions.filter((session) => session.batch_id === batch)

  const nothingRunning =
    fresh &&
    !!data &&
    !work.length &&
    !sessions.length &&
    !data.work_truncated &&
    !data.sessions_truncated &&
    !data.lane_occupied

  return (
    <>
      {unavailable && (
        <Note role="alert">
          Workflow read unavailable. Last retained details, if shown, cannot establish current idle
          or released capacity.
        </Note>
      )}
      {data && !fresh && <Note role="status">This workflow observation is stale.</Note>}
      {ordered.map((item) => (
        <Job
          key={`${item.kind}:${item.id}`}
          item={item}
          title={title(item.batch_id)}
          attention={item.batch_id === batchId ? attention : undefined}
          sessions={sessionsOf(item.batch_id)}
        />
      ))}
      {sessionOnly.map((batch) => (
        <SessionJob key={batch} batch={batch} title={title(batch)} sessions={sessionsOf(batch)} />
      ))}
      {nothingRunning && <Note>Nothing running</Note>}
      {data?.lane_occupied && !sessions.some((session) => session.occupies_lane) && (
        <Note>
          Processing lane occupied; session details are not available in this authorized projection.
        </Note>
      )}
      <Footer>
        <Small>Last work read: {data ? shortTime(data.observed_at) : 'Not yet observed'}</Small>
        {data?.work_truncated && (
          <Small>
            Work coverage is partial. Open the owning views for additional retained work.
          </Small>
        )}
        {data?.sessions_truncated && (
          <Small>
            Active-session coverage is partial. An empty displayed list does not establish no active
            agents.
          </Small>
        )}
        <Action href="#agents">Agent sessions</Action>
      </Footer>
    </>
  )
}

function latestStatus(sessions: Session[]) {
  return sessions
    .map((session) => session.latest_status)
    .filter((status) => status !== null)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0]
}

function StatusLine({ sessions, fallback }: { sessions: Session[]; fallback: string }) {
  const latest = latestStatus(sessions)
  if (!latest) {
    return <Line>{fallback}</Line>
  }

  return (
    <Line>
      {latest.text} · <time dateTime={latest.at}>{shortTime(latest.at)}</time>
    </Line>
  )
}

function Job({
  item,
  title,
  attention,
  sessions,
}: {
  item: WorkItem
  title: string
  attention?: BatchAttentionDto
  sessions: Session[]
}) {
  const kind = item.kind === 'processing' ? 'Processing' : 'Import'
  const steps = segmentSteps(item, attention)
  const pill = jobPill(item, attention?.processing.questions ?? 0)
  const href =
    item.kind === 'processing'
      ? batchHref(item.batch_id, { tab: 'processing', step: 'overview' })
      : batchHref(item.batch_id, { tab: 'changes', view: 'added', runId: item.id })

  return (
    <JobBody aria-label={`${title} · ${kind}`}>
      <Head>
        <b>{title}</b>
        <Pill status={pill.status}>{pill.word}</Pill>
      </Head>
      <ProgressSegments steps={steps} size="lg" />
      <StepLabels aria-hidden="true">
        {steps.map((step) => (
          <span key={step.label}>{step.label}</span>
        ))}
      </StepLabels>
      <StatusLine
        sessions={sessions}
        fallback={`${kind} · ${item.stage} · ${stateWords(item.state)}`}
      />
      <Action href={href}>
        {item.kind === 'processing' ? 'Open processing' : 'Open original run'}
      </Action>
      <Details>
        <summary>Details</summary>
        <p>
          {kind} · {item.stage} · {stateWords(item.state)}
        </p>
        {item.kind === 'processing' && (
          <p>
            {item.occupies_lane
              ? 'Physical lane occupied'
              : 'No physical occupancy reported for this attempt'}{' '}
            ·{' '}
            {item.input_current === null
              ? 'Input currency unknown'
              : item.input_current
                ? 'Retained input current'
                : 'Retained input stale'}
            {item.blocked_code ? ` · ${stateWords(item.blocked_code)}` : ''}
          </p>
        )}
        {!item.steps_complete && (
          <p>Fine-grained step coverage is incomplete. No percentage is inferred.</p>
        )}
        {sessions.map((session) => (
          <SessionFacts key={session.attempt_id} session={session} />
        ))}
        <p>
          Batch {item.batch_id} ·{' '}
          {item.kind === 'processing' ? `attempt ${item.attempt_id}` : `run ${item.id}`}
        </p>
      </Details>
    </JobBody>
  )
}

/** A batch whose agents run with no retained work item of their own. */
function SessionJob({
  batch,
  title,
  sessions,
}: {
  batch: string
  title: string
  sessions: Session[]
}) {
  const waiting = sessions.some((session) => session.session_state === 'waiting_input')
  const working = sessions.some((session) => session.occupies_lane)
  return (
    <JobBody aria-label={`${title} · Agents`}>
      <Head>
        <b>{title}</b>
        {waiting ? (
          <Pill status="needs-answer">Waiting for you</Pill>
        ) : (
          <Pill status={working ? 'running' : 'queued'}>{working ? 'Running' : 'Queued'}</Pill>
        )}
      </Head>
      <StatusLine sessions={sessions} fallback={`${sessions.length} agent sessions`} />
      <Action href={batchHref(batch, { tab: 'processing', step: 'overview' })}>
        Open session work
      </Action>
      <Details>
        <summary>Details</summary>
        {sessions.map((session) => (
          <SessionFacts key={session.attempt_id} session={session} />
        ))}
        <p>Batch {batch}</p>
      </Details>
    </JobBody>
  )
}

function SessionFacts({ session }: { session: Session }) {
  return (
    <p>
      {session.selection === null
        ? 'Synthetic session'
        : `${session.selection.provider} · ${
            session.actual_model
              ? `actual model ${session.actual_model}`
              : `requested model ${session.selection.model}; actual model not yet reported`
          }`}{' '}
      · {session.stage} · logical state {stateWords(session.state)} · {session.progress} ·{' '}
      {session.session_state === 'waiting_input'
        ? 'Waiting for your input · holds no slot'
        : session.occupies_lane
          ? 'Physical lane occupied'
          : session.progress === 'queued'
            ? 'Queued; physical lane not held by this session'
            : 'No physical occupancy reported'}
      {session.latest_status ? ` · ${session.latest_status.text}` : ''} · attempt{' '}
      {session.attempt_id}
    </p>
  )
}

const JobBody = styled.section`
  display: flex;
  flex-direction: column;
  gap: ${space[3]};
  padding: ${space[5]};
  & + & {
    border-top: 1px solid ${color.line};
  }
`

const Head = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${space[4]};
  min-width: 0;
  b {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`

const StepLabels = styled.span`
  display: flex;
  gap: ${space[1]};
  font-size: ${typeVar.label.size};
  color: ${color.muted};
  & > span {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`

const Line = styled.p`
  margin: 0;
  font-size: ${typeVar.small.size};
  color: ${color.muted};
  overflow-wrap: anywhere;
`

const Note = styled(Line)`
  padding: ${space[5]};
`

const Action = styled(Link)`
  align-self: flex-start;
  font-size: ${typeVar.small.size};
  ${media.compact} {
    display: inline-flex;
    align-items: center;
    min-height: ${size.touch};
  }
`

const Details = styled.details`
  font-size: ${typeVar.small.size};
  color: ${color.muted};
  overflow-wrap: anywhere;
  summary {
    cursor: pointer;
  }
  p {
    margin: ${space[2]} 0 0;
  }
  ${media.compact} {
    summary {
      line-height: ${size.touch};
    }
  }
`

const Footer = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
  padding: ${space[5]};
  border-top: 1px solid ${color.line};
`
