import type { BatchAttentionDto, HeaderWorkDto } from '@invimport/contracts'
import styled from 'styled-components'
import { color, size, space, typeVar } from '#/theme/generated/tokens'
import { batchHref } from '#/navigation/batch-route'
import {
  batchState,
  batchStepCounts,
  capitalised,
  jobState,
  PLANNED_STEP,
  processingSegments,
  segmentSteps,
  slotHeld,
  workState,
  type RetainedState,
} from '#/header/workSegments'
import { workSummary } from '#/header/workSummary'
import {
  media,
  EventTime,
  Link,
  Small,
  ProgressSegments,
  StatePill,
  WORK_STATE,
  type WorkState,
} from '#/components/ui'

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

/** A retained state in the shared words, for the diagnostics under Details. */
function stateWord(state: RetainedState) {
  return WORK_STATE[workState(state)].word
}

/** A job or step still to finish: under way, queued or waiting for the operator. */
const UNDER_WAY: ReadonlySet<WorkState> = new Set(['working', 'queued', 'waiting_for_you'])

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
  const processing = work.filter((item) => item.kind === 'processing')
  const imports = work.filter((item) => item.kind === 'import')
  // One Processing entry per batch, the open batch first; each import run is its own entry.
  const batches = [...new Set(processing.map((item) => item.batch_id))].sort(
    (a, b) => Number(b === batchId) - Number(a === batchId),
  )
  const sessionOnly = [...new Set(sessions.map((session) => session.batch_id))].filter(
    (batch) => !batches.includes(batch),
  )

  const title = (batch: string) =>
    batch === batchId ? (batchTitle ?? 'Current batch') : 'Other batch'

  const sessionsOf = (batch: string) => sessions.filter((session) => session.batch_id === batch)

  // Inside a batch only the proven idle summary says no agents work; outside one, other batches'
  // settled failures are not in the read, so it only says nothing active is listed.
  const idle = workSummary({ data, batchId, batchTitle, unavailable, fresh }).idle
  const nothingListed =
    batchId === undefined &&
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
      {batches.map((batch) => (
        <ProcessingJob
          key={batch}
          batch={batch}
          title={title(batch)}
          jobs={processing.filter((item) => item.batch_id === batch)}
          attention={batch === batchId ? attention : undefined}
          counts={batchStepCounts(data, batch, batch === batchId ? attention : undefined)}
          sessions={sessionsOf(batch)}
        />
      ))}
      {[...imports]
        .sort((a, b) => Number(b.batch_id === batchId) - Number(a.batch_id === batchId))
        .map((item) => (
          <ImportJob key={item.id} item={item} title={title(item.batch_id)} />
        ))}
      {sessionOnly.map((batch) => (
        <SessionJob key={batch} batch={batch} title={title(batch)} sessions={sessionsOf(batch)} />
      ))}
      {idle && <Note>No agents working</Note>}
      {nothingListed && <Note>No active work listed</Note>}
      {data?.lane_occupied && !sessions.some((session) => session.occupies_lane) && (
        <Note>
          Processing lane occupied; session details are not available in this authorized projection.
        </Note>
      )}
      <Footer>
        <Small>
          Last work read: {data ? <EventTime at={data.observed_at} /> : 'Not yet observed'}
        </Small>
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
      {latest.text} · <EventTime at={latest.at} />
    </Line>
  )
}

/** A batch's Processing: its planned steps, its agents' newest status line and one link. */
function ProcessingJob({
  batch,
  title,
  jobs,
  attention,
  counts,
  sessions,
}: {
  batch: string
  title: string
  jobs: WorkItem[]
  attention?: BatchAttentionDto
  counts: ReturnType<typeof batchStepCounts>
  sessions: Session[]
}) {
  const steps = processingSegments(jobs, counts)
  const questions = attention?.processing.questions ?? 0
  const state = questions > 0 ? 'waiting_for_you' : batchState(jobs)
  // A slot held by a job that stopped working says so beside Working.
  const held = !jobs.some((job) => workState(job.state) === 'working') && jobs.some(slotHeld)
  let detail: string | undefined
  if (questions > 0) {
    detail = String(questions)
  } else if (state === 'working' && held) {
    detail = 'slot held'
  }
  const lead =
    jobs.find((job) => job.steps.some((step) => UNDER_WAY.has(workState(step.state)))) ?? jobs[0]

  return (
    <JobBody aria-label={`${title} · Processing`}>
      <Head>
        <b>{title}</b>
        <StatePill state={state} detail={detail} />
      </Head>
      <ProgressSegments steps={steps} size="lg" />
      <StepLabels aria-hidden="true">
        {steps.map((step) => (
          <span key={step.label}>{step.label}</span>
        ))}
      </StepLabels>
      <StatusLine
        sessions={sessions}
        fallback={`${capitalised(PLANNED_STEP[lead.stage] ?? lead.stage)} · ${WORK_STATE[jobState(lead)].word}`}
      />
      <Action href={batchHref(batch, { tab: 'processing', step: 'overview' })}>
        Open processing
      </Action>
      <Details>
        <summary>Details</summary>
        {jobs.map(
          (job) =>
            job.kind === 'processing' && (
              <p key={job.id}>
                {job.stage} · {stateWord(job.state)} ·{' '}
                {job.occupies_lane
                  ? 'Physical lane occupied'
                  : 'No physical occupancy reported for this attempt'}{' '}
                ·{' '}
                {job.input_current === null
                  ? 'Input currency unknown'
                  : job.input_current
                    ? 'Retained input current'
                    : 'Retained input stale'}
                {job.blocked_code ? ` · ${job.blocked_code.replaceAll('_', ' ')}` : ''} · attempt{' '}
                {job.attempt_id}
              </p>
            ),
        )}
        {jobs.some((job) => !job.steps_complete) && (
          <p>Fine-grained step coverage is incomplete. No percentage is inferred.</p>
        )}
        {sessions.map((session) => (
          <SessionFacts key={session.attempt_id} session={session} />
        ))}
        <p>Batch {batch}</p>
      </Details>
    </JobBody>
  )
}

/** An import run: its own state, steps and link; Processing's questions and agents are not its. */
function ImportJob({ item, title }: { item: WorkItem; title: string }) {
  const steps = segmentSteps(item)

  return (
    <JobBody aria-label={`${title} · Import`}>
      <Head>
        <b>{title}</b>
        <StatePill state={jobState(item)} />
      </Head>
      <ProgressSegments steps={steps} size="lg" />
      <StepLabels aria-hidden="true">
        {steps.map((step) => (
          <span key={step.label}>{step.label}</span>
        ))}
      </StepLabels>
      <Line>
        Import · {item.stage} · {stateWord(item.state)}
      </Line>
      <Action href={batchHref(item.batch_id, { tab: 'changes', view: 'added', runId: item.id })}>
        Open original run
      </Action>
      <Details>
        <summary>Details</summary>
        {!item.steps_complete && (
          <p>Fine-grained step coverage is incomplete. No percentage is inferred.</p>
        )}
        <p>
          Batch {item.batch_id} · run {item.id}
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
  let state: WorkState = 'queued'
  if (sessions.some((session) => session.session_state === 'waiting_input')) {
    state = 'waiting_for_you'
  } else if (sessions.some((session) => session.occupies_lane)) {
    state = 'working'
  }
  return (
    <JobBody aria-label={`${title} · Agents`}>
      <Head>
        <b>{title}</b>
        <StatePill state={state} />
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
      · {session.stage} · logical state {stateWord(session.state)} · {session.progress} ·{' '}
      {session.session_state === 'waiting_input'
        ? 'Waiting for your input · holds no slot'
        : session.occupies_lane
          ? 'Physical lane occupied'
          : session.progress === 'queued'
            ? 'Queued; physical lane not held by this session'
            : 'No physical occupancy reported'}
      {session.latest_status && (
        <>
          {' · '}
          {session.latest_status.text} · <EventTime at={session.latest_status.at} />
        </>
      )}{' '}
      · attempt {session.attempt_id}
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
