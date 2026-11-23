import type { BatchAttentionDto, HeaderWorkDto } from '@invimport/contracts'
import styled from 'styled-components'
import { color, size, space, typeVar } from '#/theme/generated/tokens'
import type { QueryKey } from '@tanstack/react-query'
import { batchHref } from '#/navigation/batch-route'
import { useServerScope } from '#/context'
import { serverQueryKey } from '#/queries/scope'
import {
  PLANNED,
  batchPaused,
  batchState,
  batchStepCounts,
  jobState,
  processingSegments,
  segmentSteps,
  slotHeld,
  workState,
  type BatchCounts,
  type RetainedState,
} from '#/header/workSegments'
import { workSummary } from '#/header/workSummary'
import {
  EventTime,
  media,
  Link,
  Small,
  ProgressSegments,
  StatePill,
  WORK_STATE,
  type WorkState,
} from '#/components/ui'
import { ResumeBatch } from './ResumeBatch'
import { StageRow } from './StageRow'

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
  /** The reads behind the bars started after the last live hint, so working stages may move. */
  moving: boolean
  /** The open batch's counts come from its attention read, which is newer than the header's. */
  countsFromAttention: boolean
}

/** A retained state in the shared words, for the diagnostics under Details. */
function stateWord(state: RetainedState) {
  return WORK_STATE[workState(state)].word
}

/** Each job leads with what an operator acts on; lanes, coverage and IDs sit in its Details. */
export function ActivityPopover({
  data,
  batchId,
  batchTitle,
  attention,
  unavailable,
  fresh,
  moving,
  countsFromAttention,
}: Props) {
  const scope = useServerScope()
  const work = data?.work ?? []
  const sessions = data?.active_sessions ?? []
  const processing = work.filter((item) => item.kind === 'processing')
  const imports = work.filter((item) => item.kind === 'import')
  const paused = data?.paused_batches ?? []
  // One Processing entry per batch, the open batch first; each import run is its own entry. A
  // paused batch gets one even with no work listed, so it can be resumed, and so does a batch whose
  // work was cut from the bounded list while its sessions were not.
  const batches = [
    ...new Set([
      ...processing.map((item) => item.batch_id),
      ...paused.map((entry) => entry.batch_id),
      ...sessions.map((session) => session.batch_id),
    ]),
  ].sort((a, b) => Number(b === batchId) - Number(a === batchId))
  const workKey = serverQueryKey(scope, 'header-work', batchId ?? 'all')

  const title = (batch: string) => {
    const listed = paused.find((entry) => entry.batch_id === batch)?.title
    if (batch === batchId) {
      return batchTitle ?? listed ?? 'Current batch'
    }

    return listed ?? 'Other batch'
  }

  // Resume needs a current read: a stale or failed one may show a batch that is no longer paused.
  const resumeUnavailable = fresh ? undefined : 'Resume waits for a current workflow read.'

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
      {batches.map((batch) => {
        const ownCounts = batch === batchId && countsFromAttention ? attention : undefined
        const counts = batchStepCounts(data, batch, ownCounts)
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
            moving={moving}
            workKey={workKey}
            resumeUnavailable={resumeUnavailable}
          />
        )
      })}
      {[...imports]
        .sort((a, b) => Number(b.batch_id === batchId) - Number(a.batch_id === batchId))
        .map((item) => (
          <ImportJob key={item.id} item={item} title={title(item.batch_id)} />
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

/** A batch's Processing: its stage bar, one row per stage, and Resume while it is paused. */
function ProcessingJob({
  batch,
  title,
  jobs,
  attention,
  counts,
  paused,
  sessions,
  moving,
  workKey,
  resumeUnavailable,
}: {
  batch: string
  title: string
  jobs: WorkItem[]
  attention?: BatchAttentionDto
  counts: BatchCounts | undefined
  paused: boolean
  sessions: Session[]
  moving: boolean
  workKey: QueryKey
  resumeUnavailable?: string
}) {
  const steps = processingSegments(jobs, counts, paused, sessions)
  const questions = attention?.processing.questions ?? 0
  let state: WorkState = questions > 0 ? 'waiting_for_you' : batchState(jobs)
  if (questions === 0 && jobs.length === 0) {
    state = sessionsState(sessions)
  }
  // A slot held by a job that stopped working says so beside Working.
  const held = !jobs.some((job) => workState(job.state) === 'working') && jobs.some(slotHeld)
  let detail: string | undefined
  if (questions > 0) {
    detail = String(questions)
  } else if (state === 'working' && held) {
    detail = 'slot held'
  }

  return (
    <JobBody aria-label={`${title} · Processing`}>
      <Head>
        <b>{title}</b>
        {(jobs.length > 0 || questions > 0 || sessions.length > 0) && (
          <StatePill state={state} detail={detail} />
        )}
      </Head>
      {paused && (
        <PausedRow>
          <StatePill state="paused" />
          <span>No session starts new work until you resume.</span>
          <ResumeBatch batchId={batch} readKey={workKey} unavailable={resumeUnavailable} />
        </PausedRow>
      )}
      <ProgressSegments steps={steps} size="lg" still={!moving} />
      <StageRows aria-label="Stages">
        {PLANNED.map((stage, index) => (
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
        {!counts && <p>This batch&apos;s stages are not counted in this read.</p>}
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

/** A batch's state from its listed sessions alone, when its work was cut from the bounded list. */
function sessionsState(sessions: Session[]): WorkState {
  if (sessions.some((session) => session.session_state === 'waiting_input')) {
    return 'waiting_for_you'
  }
  if (sessions.some((session) => session.occupies_lane)) {
    return 'working'
  }

  return 'queued'
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

const Footer = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
  padding: ${space[5]};
  border-top: 1px solid ${color.line};
`
