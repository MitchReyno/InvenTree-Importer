import type { BatchAttentionDto, HeaderWorkDto } from '@invimport/contracts'
import styled from 'styled-components'
import { color, radius, size, space, typeVar } from '#/theme/generated/tokens'
import { batchHref } from '#/navigation/batch-route'
import {
  STAGES,
  batchPaused,
  batchPill,
  jobPill,
  batchStepCounts,
  processingSegments,
  segmentSteps,
  stageCountText,
  stagePillWord,
  stageReason,
  stageStatus,
  stateWords,
  type BatchCounts,
  type Stage,
} from '#/header/workSegments'
import {
  EventTime,
  media,
  Pill,
  Link,
  Small,
  ProgressSegments,
  StatePill,
  VisuallyHidden,
  type ProgressStep,
} from '#/components/ui'
import { ResumeBatch } from './ResumeBatch'

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
  const processing = work.filter((item) => item.kind === 'processing')
  const imports = work.filter((item) => item.kind === 'import')
  const paused = data?.paused_batches ?? []
  // One Processing entry per batch, the open batch first; each import run is its own entry. A
  // paused batch gets one even with no work listed, so it can be resumed.
  const batches = [
    ...new Set([
      ...processing.map((item) => item.batch_id),
      ...paused.map((entry) => entry.batch_id),
    ]),
  ].sort((a, b) => Number(b === batchId) - Number(a === batchId))
  const sessionOnly = [...new Set(sessions.map((session) => session.batch_id))].filter(
    (batch) => !batches.includes(batch),
  )

  const title = (batch: string) => {
    if (batch === batchId) {
      return batchTitle ?? 'Current batch'
    }

    return paused.find((entry) => entry.batch_id === batch)?.title ?? 'Other batch'
  }

  // Resume needs a current read: a stale or failed one may show a batch that is no longer paused.
  const resumeUnavailable = fresh ? undefined : 'Resume waits for a current workflow read.'

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
      {batches.map((batch) => {
        const counts = batchStepCounts(data, batch, batch === batchId ? attention : undefined)
        return (
          <ProcessingJob
            key={batch}
            batch={batch}
            title={title(batch)}
            jobs={processing.filter((item) => item.batch_id === batch)}
            attention={batch === batchId ? attention : undefined}
            counts={counts}
            paused={batchPaused(data, batch, counts)}
            sessions={sessionsOf(batch)}
            fresh={fresh}
            resumeUnavailable={resumeUnavailable}
          />
        )
      })}
      {[...imports]
        .sort((a, b) => Number(b.batch_id === batchId) - Number(a.batch_id === batchId))
        .map((item) => (
          <ImportJob key={item.id} item={item} title={title(item.batch_id)} />
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
        {data?.paused_truncated && (
          <Small>
            More batches are paused than are listed here. Resume them from{' '}
            <Link href="#agents">Agents</Link>.
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

/** A batch's Processing: its stage bar, one row per stage, and Resume while it is paused. */
function ProcessingJob({
  batch,
  title,
  jobs,
  attention,
  counts,
  paused,
  sessions,
  fresh,
  resumeUnavailable,
}: {
  batch: string
  title: string
  jobs: WorkItem[]
  attention?: BatchAttentionDto
  counts: BatchCounts | undefined
  paused: boolean
  sessions: Session[]
  fresh: boolean
  resumeUnavailable?: string
}) {
  const steps = processingSegments(jobs, counts, paused)
  const questions = attention?.processing.questions ?? 0
  let pill = batchPill(jobs)
  if (questions > 0) {
    pill = { status: 'needs-answer', word: `${questions} need you` }
  }

  return (
    <JobBody aria-label={`${title} · Processing`}>
      <Head>
        <b>{title}</b>
        {(jobs.length > 0 || questions > 0) && <Pill status={pill.status}>{pill.word}</Pill>}
      </Head>
      {paused && (
        <PausedRow>
          <StatePill state="paused" />
          <span>No session starts new work until you resume.</span>
          <ResumeBatch batchId={batch} unavailable={resumeUnavailable} />
        </PausedRow>
      )}
      <ProgressSegments steps={steps} size="lg" still={!fresh} />
      <StageRows aria-label="Stages">
        {STAGES.map((stage, index) => (
          <StageRow
            key={stage}
            batch={batch}
            stage={stage}
            step={steps[index]}
            counts={counts}
            sessions={sessions}
          />
        ))}
      </StageRows>
      <Action href={batchHref(batch, { tab: 'processing', step: 'overview' })}>
        Open processing
      </Action>
      <Details>
        <summary>Details</summary>
        {jobs.map(
          (job) =>
            job.kind === 'processing' && (
              <p key={job.id}>
                {job.stage} · {stateWords(job.state)} ·{' '}
                {job.occupies_lane
                  ? 'Physical lane occupied'
                  : 'No physical occupancy reported for this attempt'}{' '}
                ·{' '}
                {job.input_current === null
                  ? 'Input currency unknown'
                  : job.input_current
                    ? 'Retained input current'
                    : 'Retained input stale'}
                {job.blocked_code ? ` · ${stateWords(job.blocked_code)}` : ''} · attempt{' '}
                {job.attempt_id}
              </p>
            ),
        )}
        {jobs.some((job) => !job.steps_complete) && (
          <p>Fine-grained step coverage is incomplete. No percentage is inferred.</p>
        )}
        {!counts && <p>This batch&apos;s stages are not counted in this read.</p>}
        {sessions.map((session) => (
          <SessionFacts key={session.attempt_id} session={session} />
        ))}
        <p>Batch {batch}</p>
      </Details>
    </JobBody>
  )
}

/**
 * One stage: a link to its step page with its count, state and a status line, which is its newest
 * listed agent line or else a plain reason.
 */
function StageRow({
  batch,
  stage,
  step,
  counts,
  sessions,
}: {
  batch: string
  stage: Stage
  step: ProgressStep
  counts: BatchCounts | undefined
  sessions: Session[]
}) {
  const count = stageCountText(stage, counts)
  const status = stageStatus(stage, sessions)

  return (
    <li>
      <RowLink href={batchHref(batch, { tab: 'processing', step: stage })}>
        <RowHead>
          <b>{step.label}</b>
          {count && (
            <RowCount>
              <VisuallyHidden> · </VisuallyHidden>
              {count}
            </RowCount>
          )}
          <VisuallyHidden> · </VisuallyHidden>
          <StatePill state={step.state}>
            {stagePillWord(step.state, counts?.steps[stage])}
          </StatePill>
        </RowHead>
        <RowStatus>
          {status ? (
            <>
              {status.text} · <EventTime at={status.at} />
            </>
          ) : (
            stageReason(stage, step.state, counts)
          )}
        </RowStatus>
      </RowLink>
    </li>
  )
}

/** An import run: its own state, steps and link; Processing's questions and agents are not its. */
function ImportJob({ item, title }: { item: WorkItem; title: string }) {
  const steps = segmentSteps(item)
  const pill = jobPill(item)

  return (
    <JobBody aria-label={`${title} · Import`}>
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
      <Line>
        Import · {item.stage} · {stateWords(item.state)}
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
      {session.latest_status && (
        <>
          {' · '}
          {session.latest_status.text} ·{' '}
          <time dateTime={session.latest_status.at}>{shortTime(session.latest_status.at)}</time>
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

const PausedRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[3]};
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`

const StageRows = styled.ul`
  display: flex;
  flex-direction: column;
  gap: ${space[1]};
  margin: 0;
  padding: 0;
  list-style: none;
`

const RowLink = styled.a`
  display: flex;
  flex-direction: column;
  gap: ${space[1]};
  padding: ${space[3]} ${space[4]};
  border-radius: ${radius.btn};
  color: ${color.fg};
  text-decoration: none;
  &:hover {
    background: ${color.surface2};
  }
  ${media.compact} {
    min-height: ${size.touch};
  }
`

const RowHead = styled.span`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[3]};
  min-width: 0;
  & > :last-child {
    margin-left: auto;
  }
`

const RowCount = styled.span`
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`

const RowStatus = styled.span`
  font-size: ${typeVar.small.size};
  color: ${color.muted};
  overflow-wrap: anywhere;
`

const Footer = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
  padding: ${space[5]};
  border-top: 1px solid ${color.line};
`
