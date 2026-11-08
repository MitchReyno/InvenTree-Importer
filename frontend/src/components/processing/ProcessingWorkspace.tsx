import { IntakeRequestError } from '@invimport/contracts/client'
import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { size, space } from '../../theme/generated/tokens'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { serverQueryKey, useServerScope } from '../../queries/scope'
import { useRetainedPollInterval } from '../operations/LiveUpdates'
import type {
  CaptureSnapshotDto,
  ProcessingAnswerDto,
  ProcessingSnapshotDto,
  ProcessingStartDto,
} from '@invimport/contracts'
import type { AgentsRead, ProcessingClient, ProcessingView } from '../../processing/types'
import { Heading, Link, Panel, Small, Summary } from '../ui/primitives'
import { Banner } from '../ui/Banner'
import { Button } from '../ui/Button'
import type { MediaClient } from '../../media/types'
import { ProcessingImages } from './ProcessingImages'
import { ProcessingJobCard } from './ProcessingJobCard'
import { SessionPanel } from './SessionPanel'
import { QuestionAnswer } from './QuestionAnswer'
import { ProcessingOverview } from './ProcessingOverview'
import { StepPage } from './StepPage'
import { ExamineView, type SharperRequestStore } from './ExamineView'
import { InstructionField } from './InstructionField'
import { Muted, STEP_LABEL } from './ProcessingParts'
import { Dialog } from '../ui/Dialog'
import { batchHref, processingStepFor } from '../../navigation/batch-route'
import { retainedJobsSource } from '../../processing/source'
import { useDirtySources } from '../../operator/useDirtySources'
import { openQuestionsByLot } from '../../operator/review-model'
import type { AgentSessionListDto, BatchAttentionDto, CaptureEditDto } from '@invimport/contracts'

const ACTIVITY_LIMIT = 6
const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

/** The batch's newest agent status lines, oldest first; the newest is current while it runs. */
function recentActivity(
  snapshot: ProcessingSnapshotDto | undefined,
  subjectLabel: (id: string | null) => string,
) {
  const lines = (snapshot?.jobs ?? [])
    .filter((job) => job.latest_status)
    .sort((a, b) => a.latest_status!.at.localeCompare(b.latest_status!.at))
    .slice(-ACTIVITY_LIMIT)

  return lines.map((job, index) => {
    const at = new Date(job.latest_status!.at)
    return {
      text: `${STEP_LABEL[processingStepFor(job.stage)] ?? 'Processing'} · ${subjectLabel(job.subject_id)}: ${job.latest_status!.text}`,
      time: Number.isNaN(at.getTime()) ? job.latest_status!.at : clock.format(at),
      current: index === lines.length - 1 && job.session_state === 'running',
    }
  })
}

/** When this batch's first agent session started, as a clock time. */
function firstStart(sessions: AgentSessionListDto['sessions'] | undefined, batchId: string) {
  const starts = (sessions ?? [])
    .filter((session) => session.batch_id === batchId && session.started_at)
    .map((session) => session.started_at!)
    .sort()
  const at = starts[0] ? new Date(starts[0]) : undefined
  return at && !Number.isNaN(at.getTime()) ? clock.format(at) : undefined
}

/** Whether a job belongs on a Processing step; Examine covers the Reading and Identifying stages. */
function onStep(stage: string, view: ProcessingView) {
  return view === 'overview' || processingStepFor(stage) === view
}

interface Props {
  /** The batch's capture edit, for Examine's reading and region corrections. */
  edit?: (change: CaptureEditDto['change']) => Promise<boolean | void>
  /** A job whose session drawer opens on arrival, from a session link. */
  sessionId?: string | null
  sharperRequests?: SharperRequestStore
  batch: CaptureSnapshotDto
  media?: MediaClient
  client: ProcessingClient
  view: ProcessingView
  questionId?: string
  navigate: (view: ProcessingView, questionId?: string) => void
  onDirtyChange: (dirty: boolean) => void
  onSaved: () => Promise<void>
  retiredLotIds?: ReadonlySet<string>
  /** Counts for the Overview's links to Review and Changes. */
  attention?: BatchAttentionDto
  /** The agent-session read, for the batch's start time and the slot limit. */
  agents?: AgentsRead
  /** Files no lot uses, offered on the Overview as a way into the Map. */
  unusedFiles?: number
  /** The batch instructions and how to save them; absent where this setup has none. */
  instructions?: {
    text: string | undefined
    unavailable?: boolean
    instruct?: (text: string, revision: string, key: string) => Promise<unknown>
  }
}

type PinnedQuestion = {
  question: ProcessingSnapshotDto['jobs'][number]['questions'][number]
  captureRevision: string
}

export function ProcessingWorkspace({
  batch,
  client,
  media,
  view,
  questionId,
  navigate,
  onDirtyChange,
  onSaved,
  retiredLotIds = NO_RETIRED_LOTS,
  attention,
  agents,
  unusedFiles,
  instructions,
  sessionId = null,
  sharperRequests,
  edit,
}: Props) {
  const [sessionJobId, setSessionJobId] = useState<string | null>(sessionId)
  // The answer form and the instruction field each keep the navigation guard on their own.
  const drafts = useDirtySources(onDirtyChange)
  // A save reloads Processing; the other draft is locked until that finishes.
  const [saving, setSaving] = useState<'answer' | 'instructions' | null>(null)
  // A route change shows the session its link names, or none: opening a question navigates, and
  // the drawer closes only once the route actually changes.
  const routeKey = useRef(`${view}:${questionId}:${sessionId}`)
  useEffect(() => {
    if (routeKey.current !== `${view}:${questionId}:${sessionId}`) {
      routeKey.current = `${view}:${questionId}:${sessionId}`
      setSessionJobId(sessionId)
    }
  }, [questionId, view, sessionId])
  const pollInterval = useRetainedPollInterval()
  const scope = useServerScope()
  const queryKey = serverQueryKey(scope, 'processing', batch.id)
  const scopeIdentity = JSON.stringify(queryKey)
  const mountedContext = useRef(scopeIdentity).current
  // Query-cache writes can count as fetched data; only this mounted read can verify commands.
  const successfulRead = useRef(false)
  const queryClient = useQueryClient()
  const snapshotQuery = useQuery({
    queryKey,
    queryFn: async () => {
      try {
        const snapshot = await client.read(batch.id)
        if (scopeIdentity === mountedContext) {
          successfulRead.current = true
        }
        return snapshot
      } catch (error) {
        successfulRead.current = false
        throw error
      }
    },
    refetchInterval: pollInterval,
  })
  const snapshot = snapshotQuery.data
  // The Agents page's own reads, so both share one cache entry.
  const agentSessions = useQuery({
    queryKey: serverQueryKey(scope, 'agent-sessions', 'newest'),
    queryFn: () => agents!.sessions(),
    enabled: agents !== undefined && view === 'overview',
    refetchInterval: pollInterval,
  })
  const agentSettings = useQuery({
    queryKey: serverQueryKey(scope, 'agent-settings'),
    queryFn: () => agents!.settings(),
    enabled: agents !== undefined && view === 'overview',
    refetchInterval: pollInterval,
  })

  // A read that failed or paused keeps old data; it is withheld rather than shown as current.
  const liveRead = (read: { isSuccess: boolean; isError: boolean; fetchStatus: string }) =>
    read.isSuccess && !read.isError && read.fetchStatus !== 'paused'

  // The list is one page across every batch, so a start time needs the whole history.
  const started =
    liveRead(agentSessions) && agentSessions.data?.next_before === null
      ? firstStart(agentSessions.data.sessions, batch.id)
      : undefined
  const sessionLimit = liveRead(agentSettings) ? agentSettings.data?.session_concurrency : undefined
  // Capture's media read names Examine's photos by file and group.
  const mediaSnapshot = useQuery({
    queryKey: serverQueryKey(scope, 'media', batch.id),
    queryFn: () => media!.snapshot(batch.id),
    enabled: media !== undefined && view === 'examine',
    refetchInterval: pollInterval,
  })
  const offline = snapshotQuery.isError || snapshotQuery.fetchStatus === 'paused'
  const waitingForRead =
    !successfulRead.current ||
    !snapshotQuery.isFetchedAfterMount ||
    !snapshotQuery.isSuccess ||
    scopeIdentity !== mountedContext
  const [pinned, setPinned] = useState<PinnedQuestion | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const startSubmission = useRef<{ fingerprint: string; key: string } | null>(null)
  useEffect(() => {
    if (snapshotQuery.fetchStatus === 'paused') {
      successfulRead.current = false
    }
  }, [snapshotQuery.fetchStatus])

  useEffect(() => {
    if (!questionId) {
      setPinned(null)
      return
    }
    // Retain the first exact question/context read for this URL. Polling cannot substitute another.
    if (pinned?.question.id === questionId) {
      return
    }
    // Warm query data is useful for status only; it cannot establish a new answer context.
    if (waitingForRead || offline) {
      return
    }
    const question = snapshot?.jobs
      .flatMap((job) => job.questions)
      .find((question) => question.id === questionId)
    if (question && snapshot) {
      setPinned({ question, captureRevision: snapshot.capture_revision })
    }
  }, [questionId, snapshot, pinned, waitingForRead, offline])

  function commandReadAvailable() {
    const current = queryClient.getQueryState(queryKey)
    return (
      !batch.archived &&
      !busy &&
      !waitingForRead &&
      successfulRead.current &&
      current?.status === 'success' &&
      current.fetchStatus !== 'paused'
    )
  }

  async function refresh() {
    const result = await snapshotQuery.refetch({ throwOnError: true })
    if (!result.data) {
      throw new Error('processing_snapshot_missing')
    }
  }

  async function perform(work: () => Promise<unknown>) {
    if (!commandReadAvailable()) {
      throw new Error('processing_fresh_read_required')
    }
    setBusy(true)
    setError('')
    let commandFailed = false
    try {
      await work()
    } catch (failure) {
      commandFailed = true
      setError(
        failure instanceof IntakeRequestError && failure.code === 'subject_retired'
          ? 'A selected lot was split or merged. Choose its successor lots instead.'
          : 'Command not confirmed. Inspect retained status before deciding whether to submit another command.',
      )
    }

    try {
      await refresh()
    } catch {
      const message = commandFailed
        ? 'Command not confirmed and current status is unavailable. Your input and original delivery identity are kept.'
        : 'The command was saved, but current status is unavailable. Refresh retained status before further commands.'
      setError(message)
    } finally {
      setBusy(false)
    }

    if (commandFailed) {
      throw new Error('processing_command_not_confirmed')
    }
  }

  async function answer(id: string, input: ProcessingAnswerDto, key: string) {
    setSaving('answer')
    try {
      await perform(() => client.answer(batch.id, id, input, key))
      drafts.forSource('answer')(false)
      try {
        await onSaved()
      } catch {
        setError(
          'Answer saved. Current capture is unavailable; refresh before making another change.',
        )
      }
    } finally {
      setSaving(null)
    }
  }

  const examineLead = snapshot?.jobs.find(
    (job) => job.stage === 'examine' && job.subject_id === null,
  )
  /** Sends the Examine lead session a request for a sharper photo, through its chat. */
  const askSharper =
    client.chat && examineLead?.session_state && examineLead.session_state !== 'cancelled'
      ? async (name: string, key: string) => {
          await client.chat!(
            batch.id,
            examineLead.id,
            {
              idempotency_key: key,
              text: `Please ask for a sharper photo of “${name}”: its markings are hard to read.`,
            },
            key,
          )
        }
      : undefined

  async function saveInstructions(text: string, revision: string, key: string) {
    setSaving('instructions')
    try {
      await instructions?.instruct?.(text, revision, key)
    } finally {
      setSaving(null)
    }
  }

  function start() {
    const input: ProcessingStartDto = {
      schema_version: 'bench-intake-processing/1',
      expected_capture_revision: batch.revision,
      subject_ids: selected,
      stages: ['reading', 'identifying', 'research', 'images', 'inventory'],
    }
    const fingerprint = JSON.stringify(input)
    if (startSubmission.current?.fingerprint !== fingerprint) {
      startSubmission.current = { fingerprint, key: crypto.randomUUID() }
    }
    const key = startSubmission.current.key
    void perform(async () => {
      await client.start(batch.id, input, key)
      startSubmission.current = null
    }).catch(() => {})
  }

  /** Explicitly replace the provider conversation while retaining its application lineage. */
  function restart(job: ProcessingSnapshotDto['jobs'][number]) {
    if (!client.replaceSession) {
      return
    }
    void perform(() =>
      client.replaceSession!(
        batch.id,
        job.id,
        {
          expected_capture_revision: batch.revision,
          expected_revision: job.revision,
          attempt_id: job.attempt_id,
        },
        crypto.randomUUID(),
      ),
    ).catch(() => {})
  }

  const jobs = snapshot?.jobs.filter((job) => onStep(job.stage, view)) ?? []
  const currentQuestion = snapshot?.jobs
    .flatMap((job) => job.questions)
    .find((question) => question.id === questionId)
  const unconfigured = snapshot?.runner_status === 'unconfigured'
  const disabled = batch.archived || busy || offline || waitingForRead
  const runnerDisabled = disabled || unconfigured
  const subjects = new Map(
    [...batch.lots, ...batch.parts].map((subject) => [subject.id, subject.label] as const),
  )

  const subjectLabel = (id: string | null) =>
    id === null ? 'Whole batch' : (subjects.get(id) ?? 'Unknown subject')

  const activeLotIds = new Set(
    batch.lots.filter((lot) => !retiredLotIds.has(lot.id)).map((lot) => lot.id),
  )
  const source = snapshot ? retainedJobsSource(snapshot, subjects, activeLotIds) : null
  const sessionJob = snapshot?.jobs.find((job) => job.id === sessionJobId && job.session_state)
  const activity = recentActivity(snapshot, subjectLabel)
  const queue = snapshot && (
    <details>
      <Summary>Queue work for selected saved subjects</Summary>
      <Selection
        disabled={batch.archived}
        aria-label="Select saved subjects for a new processing attempt"
      >
        {[...batch.lots.filter((lot) => !retiredLotIds.has(lot.id)), ...batch.parts].map(
          (subject) => (
            <label key={subject.id}>
              <input
                type="checkbox"
                checked={selected.includes(subject.id)}
                onChange={() =>
                  setSelected((previous) =>
                    previous.includes(subject.id)
                      ? previous.filter((id) => id !== subject.id)
                      : [...previous, subject.id],
                  )
                }
              />
              {subject.label}
            </label>
          ),
        )}
      </Selection>
      <Button
        disabled={
          runnerDisabled || !selected.length || snapshot.capture_revision !== batch.revision
        }
        onClick={start}
      >
        Queue new processing attempts
      </Button>
      <Small>New attempts preserve saved human values and previous results.</Small>
    </details>
  )
  const jobCards = (
    <>
      {jobs.map((job) => (
        <div key={job.id}>
          <ProcessingJobCard
            key={job.id}
            job={job}
            batch={batch}
            disabled={disabled}
            chooseQuestion={(id) => navigate(view, id)}
            cancel={() => {
              void perform(() =>
                client.cancel(
                  batch.id,
                  job.id,
                  { expected_revision: job.revision, attempt_id: job.attempt_id },
                  crypto.randomUUID(),
                ),
              ).catch(() => {})
            }}
          />
          {job.subject_id !== null &&
            batch.lots.some((lot) => lot.id === job.subject_id) &&
            !retiredLotIds.has(job.subject_id) && (
              <Button
                as="a"
                variant="link"
                size="sm"
                href={batchHref(batch.id, {
                  tab: 'review',
                  view: 'lots',
                  lotId: job.subject_id ?? undefined,
                })}
              >
                Open this lot in Review
              </Button>
            )}
        </div>
      ))}
    </>
  )

  return (
    <Workspace>
      {batch.archived && (
        <div role="status">
          <Banner tone="plain">
            Processing is read-only while this batch is archived. Resume it in the batch header to
            make changes.
          </Banner>
        </div>
      )}
      {unconfigured && (
        <div role="status">
          <Banner tone="warn">
            Processing setup required. The operator must configure a persistent private runner
            channel before work can start.
          </Banner>
        </div>
      )}
      <Banner tone="info">
        {snapshot?.runner_status === 'native_unverified'
          ? 'Native agent profile · requires a saved default and supervised worker. Live provider access has not been qualified.'
          : 'Synthetic processing fixture · actual provider support is not qualified.'}{' '}
        Closing this browser does not cancel saved work.
      </Banner>
      {offline && (
        <div role="alert">
          <Banner tone="bad">
            Processing status unavailable. The last snapshot is shown; commands are disabled.
          </Banner>
        </div>
      )}
      {error && (
        <div role="alert">
          <Banner tone="bad">{error}</Banner>
        </div>
      )}
      {waitingForRead && snapshot && !offline && (
        <div role="status">
          <Banner tone="plain">
            Verifying current processing state. Cached results cannot authorize commands.
          </Banner>
        </div>
      )}
      {!snapshot || !source ? (
        <Muted role="status">Reading retained processing state…</Muted>
      ) : (
        <>
          {view !== 'overview' && (
            <Panel>
              <Heading>
                {snapshot.jobs.filter((job) => job.state === 'running').length} running ·{' '}
                {snapshot.jobs.filter((job) => job.state === 'waiting_for_user').length} need
                answers · {snapshot.jobs.filter((job) => job.state === 'ready').length} ready
              </Heading>
              <Small>
                One research lane per account. A waiting question frees the lane for other lots.
              </Small>
              {queue}
            </Panel>
          )}
          {questionId && pinned?.question.id === questionId ? (
            <>
              <QuestionAnswer
                key={pinned.question.id}
                question={pinned.question}
                captureRevision={pinned.captureRevision}
                currentQuestion={currentQuestion}
                currentCaptureRevision={snapshot.capture_revision}
                disabled={
                  runnerDisabled || drafts.isDirty('instructions') || drafts.isDirty('correction')
                }
                readOnly={batch.archived || saving === 'instructions'}
                captureHref={batchHref(batch.id, { tab: 'capture' })}
                answer={answer}
                onDirtyChange={drafts.forSource('answer')}
              />
              {drafts.isDirty('instructions') && (
                <Small>
                  Save or discard the batch instructions first; saving the answer reloads
                  Processing.
                </Small>
              )}
              {drafts.isDirty('correction') && (
                <Small>
                  Save or discard the correction first; saving the answer reloads Processing.
                </Small>
              )}
            </>
          ) : (
            questionId && (
              <Banner tone="warn">
                {waitingForRead || offline
                  ? 'The selected question cannot be opened until current state is available.'
                  : 'The pinned question is unavailable. Choose a current question explicitly.'}
              </Banner>
            )
          )}
          {view === 'overview' ? (
            <ProcessingOverview
              batchId={batch.id}
              source={source}
              attention={attention}
              onOpenSession={setSessionJobId}
              instructions={
                <InstructionField
                  text={instructions ? instructions.text : ''}
                  revision={batch.revision}
                  instruct={
                    batch.archived || !instructions?.instruct ? undefined : saveInstructions
                  }
                  locked={saving === 'answer'}
                  unavailable={instructions?.unavailable}
                  readOnlyReason={
                    batch.archived ? 'Resume the batch to change its instructions.' : undefined
                  }
                  saveBlockedReason={
                    drafts.isDirty('answer')
                      ? 'Save or discard the answer first; saving reloads Processing.'
                      : drafts.isDirty('correction')
                        ? 'Save or discard the correction first; saving reloads Processing.'
                        : undefined
                  }
                  onDirtyChange={drafts.forSource('instructions')}
                />
              }
              activity={activity}
              queue={queue}
              unusedFiles={unusedFiles}
              started={started}
              sessionLimit={sessionLimit}
            />
          ) : (
            <StepPage
              batchId={batch.id}
              step={view}
              source={source}
              onOpenSession={setSessionJobId}
            >
              {view === 'images' || jobs.length > 0 ? (
                <>
                  {view === 'images' && <ProcessingImages batchId={batch.id} client={media} />}
                  {view === 'examine' && (
                    <ExamineView
                      batch={batch}
                      lead={jobs.find((job) => job.stage === 'examine' && job.subject_id === null)}
                      media={liveRead(mediaSnapshot) ? mediaSnapshot.data : undefined}
                      // A question on a shared Part questions every lot that uses it, as in Review.
                      questionedLots={new Set(openQuestionsByLot(snapshot, batch).keys())}
                      edit={batch.archived ? undefined : edit}
                      locked={drafts.isDirty('answer') || drafts.isDirty('instructions')}
                      askSharper={askSharper}
                      requestStore={sharperRequests}
                      onDirtyChange={drafts.forSource('correction')}
                    />
                  )}
                  {jobCards}
                </>
              ) : undefined}
            </StepPage>
          )}
          {sessionJob && client.session && client.chat && (
            <Dialog
              placement="side"
              title={`${STEP_LABEL[processingStepFor(sessionJob.stage)] ?? 'Processing'} · ${subjectLabel(sessionJob.subject_id)}`}
              onClose={() => {
                setSessionJobId(null)
                // A session link's query would reopen the drawer when the batch next reloads.
                const [hash, query] = location.hash.split('?')
                if (query && new URLSearchParams(query).has('session')) {
                  location.replace(hash)
                }
              }}
            >
              {sessionJob.questions
                .filter((question) => question.state === 'open')
                .map((question) => (
                  <Link
                    key={question.id}
                    onClick={() => {
                      // On this question's own step page the link changes no route.
                      if (
                        question.id === questionId &&
                        processingStepFor(sessionJob.stage) === view
                      ) {
                        setSessionJobId(null)
                      }
                    }}
                    href={batchHref(batch.id, {
                      tab: 'processing',
                      step: processingStepFor(sessionJob.stage),
                      questionId: question.id,
                    })}
                  >
                    {question.spec.prompt}
                  </Link>
                ))}
              <SessionPanel
                batchId={batch.id}
                job={sessionJob}
                client={{ session: client.session, chat: client.chat, failure: client.failure }}
                startFresh={() => restart(sessionJob)}
                freshDisabled={runnerDisabled || !client.replaceSession}
              />
            </Dialog>
          )}
        </>
      )}
    </Workspace>
  )
}

const NO_RETIRED_LOTS: ReadonlySet<string> = new Set()

const Workspace = styled.section`
  display: grid;
  gap: ${space[6]};
  min-width: 0;
  > ${Panel} {
    margin-bottom: 0;
  }
`

const Selection = styled.fieldset`
  border: 0;
  margin: ${space[8]} 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: ${space[4]} ${space[10]};
  label {
    display: flex;
    gap: ${space[4]};
    align-items: center;
    min-height: ${size.touch};
  }
`
