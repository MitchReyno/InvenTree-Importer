import { IntakeRequestError } from '@invimport/contracts/client'
import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { color, radius, ring, size, space } from '#/theme/generated/tokens'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { serverQueryKey } from '#/queries/scope'
import { useFreshRead } from '#/queries/useFreshRead'
import { useRestoredSnapshot, useSnapshotWriter } from '#/queries/useSnapshot'
import {
  questionView,
  type BatchAttentionDto,
  type CaptureSnapshotDto,
  type ProcessingAnswerDto,
  type ProcessingQuestionDto,
  type ProcessingSnapshotDto,
  type ProcessingStartDto,
} from '@invimport/contracts'
import { confirmedAnswerRefusal } from '#/processing/question-summary'
import type { ProcessingClient, ProcessingView } from '#/processing/types'
import {
  AiMark,
  Link,
  Panel,
  Small,
  Summary,
  Banner,
  Button,
  Dialog,
  PageStack,
  HelpButton,
  ReadState,
} from '#/components/ui'
import { ProcessingImages } from './ProcessingImages'
import { ProcessingInventory } from './ProcessingInventory'
import { DrawerAnswers } from './DrawerAnswers'
import type { DrawerRestoreStore } from '#/processing/drawer-restore'
import { ProcessingJobCard } from './ProcessingJobCard'
import { SessionPanel } from './SessionPanel'
import { QuestionAnswer } from './QuestionAnswer'
import { ProcessingOverview } from './ProcessingOverview'
import { ProcessingSkeleton } from './ProcessingSkeleton'
import { StepPage } from './StepPage'
import { ExamineView, type SharperRequestStore } from './ExamineView'
import { InstructionField } from './InstructionField'
import { STEP_LABEL } from './ProcessingParts'
import { batchHref, processingStepFor } from '#/navigation/batch-route'
import { lotsFormed } from '#/processing/lots-formed'
import { lotSteps, stepSummary, type LotStage } from '#/processing/lot-steps'
import { retainedJobsSource } from '#/processing/source'
import { useDirtySources } from '#/operator/useDirtySources'
import { openQuestionsByLot } from '#/operator/review-model'
import type { AgentSessionListDto } from '@invimport/contracts'
import type { InstructionDelivery } from '#/processing/instruction-delivery'
import { useApiClients, useServerScope, useRetainedPollInterval } from '#/context'
import type { CaptureEdit } from '#/capture/types'

const ACTIVITY_LIMIT = 6

/** How a step works, behind the help button beside its page heading. */
const STEP_HELP: Partial<Record<ProcessingView, string>> = {
  research:
    'Each account researches one lot at a time. A lot waiting for your answer steps aside, so another lot can research meanwhile.',
}

/** The batch's newest agent status lines, oldest first; the newest is current while it runs. */
function recentActivity(
  snapshot: ProcessingSnapshotDto | undefined,
  subjectLabel: (id: string | null) => string,
) {
  const lines = (snapshot?.jobs ?? [])
    .filter((job) => job.latest_status)
    .sort((a, b) => a.latest_status!.at.localeCompare(b.latest_status!.at))
    .slice(-ACTIVITY_LIMIT)

  return lines.map((job, index) => ({
    text: `${STEP_LABEL[processingStepFor(job.stage)] ?? 'Processing'} · ${subjectLabel(job.subject_id)}: ${job.latest_status!.text}`,
    at: job.latest_status!.at,
    current: index === lines.length - 1 && job.session_state === 'running',
  }))
}

/** When this batch's first agent session started. */
function firstStart(sessions: AgentSessionListDto['sessions'] | undefined, batchId: string) {
  const starts = (sessions ?? [])
    .filter((session) => session.batch_id === batchId && session.started_at)
    .map((session) => session.started_at!)
    .sort()

  return starts[0]
}

/** The per-lot steps a lot table pill can focus; Examine runs once for the batch. */
function lotStage(view: ProcessingView): LotStage | null {
  return view === 'research' || view === 'images' || view === 'inventory' ? view : null
}

/** Whether a job belongs on a Processing step; Examine covers the Reading and Identifying stages. */
function onStep(stage: string, view: ProcessingView) {
  return view === 'overview' || processingStepFor(stage) === view
}

interface Props {
  /** The batch's capture edit, for Examine's reading and region corrections. */
  edit?: CaptureEdit
  /** A job whose session drawer opens on arrival, from a session link. */
  sessionId?: string | null
  sharperRequests?: SharperRequestStore
  /** Brings an open session drawer back after an answer's reload remounts Processing. */
  drawerRestore?: DrawerRestoreStore
  batch: CaptureSnapshotDto
  client: ProcessingClient
  view: ProcessingView
  questionId?: string
  /** A lot whose output this step opens in view and highlighted, from the address. */
  focusLotId?: string | null
  /** The batch attention read the header counts from, for the Overview's Needs you. */
  attention?: BatchAttentionDto
  /** The attention read failed or paused; Needs you says so rather than waiting. */
  attentionUnavailable?: boolean
  navigate: (view: ProcessingView, questionId?: string) => void
  onDirtyChange: (dirty: boolean) => void
  onSaved: () => Promise<void>
  retiredLotIds?: ReadonlySet<string>
  /** The batch instructions and how to save them; absent where this setup has none. */
  instructions?: {
    text: string | undefined
    unavailable?: boolean
    instruct?: (text: string, revision: string, key: string) => Promise<unknown>
    /** Whether the saved instructions reached the agents, kept across Processing's remounts. */
    delivery?: InstructionDelivery
    /** Sends the saved instructions to the agents again. */
    deliver?: () => Promise<void>
  }
  /**
   * Shown from restored snapshots while the batch's own fresh read is still landing: every command
   * and edit stays unavailable, whatever this mount's reads verify.
   */
  displayOnly?: boolean
}

type PinnedQuestion = {
  question: ProcessingSnapshotDto['jobs'][number]['questions'][number]
  captureRevision: string
}

export function ProcessingWorkspace({
  batch,
  client,
  view,
  questionId,
  focusLotId = null,
  attention,
  attentionUnavailable = false,
  navigate,
  onDirtyChange,
  onSaved,
  retiredLotIds = NO_RETIRED_LOTS,
  instructions,
  sessionId = null,
  sharperRequests,
  drawerRestore,
  edit,
  displayOnly = false,
}: Props) {
  const { agents, media } = useApiClients()
  // A route change shows the session its link names, or none: opening a question navigates, and
  // the drawer closes only once the route actually changes.
  const route = `${view}:${questionId}:${sessionId}`
  // A drawer open when an answer's reload remounted Processing comes back on the same route.
  const [restored] = useState(() => {
    const pending = drawerRestore?.peek()

    return pending && pending.route === route ? pending : null
  })
  const [drawer, setDrawer] = useState({ route, jobId: sessionId ?? restored?.jobId ?? null })
  if (drawer.route !== route) {
    setDrawer({ route, jobId: sessionId })
  }
  const sessionJobId = drawer.route === route ? drawer.jobId : sessionId

  function setSessionJobId(jobId: string | null) {
    setDrawer({ route, jobId })
  }

  // Every mount clears the store once its state has read it, matching route or not. Unmounting
  // disarms an answer no reload carried, so a later reload from another tab can't carry it.
  useEffect(() => {
    drawerRestore?.clear()
    return () => drawerRestore?.disarm()
  }, [drawerRestore])

  // The answer form and the instruction field each keep the navigation guard on their own.
  const drafts = useDirtySources(onDirtyChange)
  // The pinned answer and each drawer answer are the only drafts besides these two.
  const answerDirty = drafts.hasOtherSources('instructions', 'correction')
  // A save reloads Processing; the other draft is locked until that finishes.
  const [saving, setSaving] = useState<'answer' | 'instructions' | null>(null)
  const pollInterval = useRetainedPollInterval()
  const scope = useServerScope()
  const queryKey = serverQueryKey(scope, 'processing', batch.id)
  const queryClient = useQueryClient()
  const restoredSnapshot = useRestoredSnapshot('processing', batch.id)
  // Only a read this mount saw start verifies commands; cache writes and snapshots never do.
  const fresh = useFreshRead({
    queryKey,
    queryFn: () => client.read(batch.id),
    refetchInterval: pollInterval,
    restored: restoredSnapshot,
  })
  const snapshotQuery = fresh.query
  useSnapshotWriter(
    'processing',
    batch.id,
    fresh.verified ? snapshotQuery.data : undefined,
    fresh.verifiedRead,
  )
  const snapshot = fresh.data
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
  // The batch's own read says whether it is paused; a change shows once it is read again. Pause
  // and Resume send no revision, so they wait for a read started after the last live hint.
  const revisionlessReady = !displayOnly && fresh.settledAfterHint
  const revisionlessReason = revisionlessReady ? undefined : (fresh.reason ?? 'Updating…')
  const pause =
    agents?.pause && snapshot
      ? {
          paused: snapshot.paused === true,
          unavailableReason: revisionlessReason,
          change: async (paused: boolean) => {
            if (displayOnly || !fresh.settledAfterHintNow()) {
              throw new Error('processing_fresh_read_required')
            }
            await agents.pause!(batch.id, paused)
            await Promise.all([
              queryClient.invalidateQueries({ queryKey }),
              queryClient.invalidateQueries({ queryKey: serverQueryKey(scope, 'agent-sessions') }),
            ])
          },
        }
      : undefined
  // Capture's media read names Examine's photos by file and group.
  const mediaSnapshot = useQuery({
    queryKey: serverQueryKey(scope, 'media', batch.id),
    queryFn: () => media!.snapshot(batch.id),
    enabled: media !== undefined && view === 'examine',
    refetchInterval: pollInterval,
  })
  const offline = fresh.phase === 'failed'
  // Edits and instructions are closed in an archived batch, and while only restored data shows.
  const fenced = batch.archived || displayOnly
  const waitingForRead = displayOnly || !fresh.verified
  const [pinned, setPinned] = useState<PinnedQuestion | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const startSubmission = useRef<{ fingerprint: string; key: string } | null>(null)
  // Pins the first exact question/context read for this URL, during render so no frame shows it
  // as unavailable. Polling cannot substitute another; warm cache data cannot establish one.
  if (!questionId) {
    if (pinned) {
      setPinned(null)
    }
  } else if (pinned?.question.id !== questionId && !waitingForRead && !offline && snapshot) {
    const question = snapshot.jobs
      .flatMap((job) => job.questions)
      .find((candidate) => candidate.id === questionId)
    if (question) {
      setPinned({ question, captureRevision: snapshot.capture_revision })
    }
  } else if (
    pinned &&
    snapshot &&
    pinned.captureRevision !== snapshot.capture_revision &&
    !waitingForRead &&
    !offline &&
    !drafts.isDirty('answer') &&
    saving !== 'answer'
  ) {
    // Another answer moved the capture revision; a clean form follows it so it stays answerable.
    const question = snapshot.jobs
      .flatMap((job) => job.questions)
      .find((candidate) => candidate.id === questionId && candidate.state === 'open')
    if (question) {
      setPinned({ question, captureRevision: snapshot.capture_revision })
    }
  }

  function commandReadAvailable() {
    return !batch.archived && !busy && !displayOnly && fresh.commandsReadyNow()
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
    let refusedAnswer: IntakeRequestError | null = null
    try {
      await work()
    } catch (failure) {
      commandFailed = true
      // The server read the answer and refused it; its form marks the step and keeps the draft.
      refusedAnswer = confirmedAnswerRefusal(failure)
      if (!refusedAnswer) {
        setError(
          failure instanceof IntakeRequestError && failure.code === 'subject_retired'
            ? 'A selected lot was split or merged. Choose its successor lots instead.'
            : 'Command not confirmed. Inspect retained status before deciding whether to submit another command.',
        )
      }
    }

    try {
      await refresh()
    } catch {
      let message =
        'The command was saved, but current status is unavailable. Refresh retained status before further commands.'
      if (refusedAnswer) {
        // A refusal is confirmed: nothing was saved, and the form already keeps the draft.
        message =
          'The answer wasn\u2019t accepted, and current status is unavailable. Refresh before sending it again.'
      } else if (commandFailed) {
        message =
          'Command not confirmed and current status is unavailable. Your input and original delivery identity are kept.'
      }
      setError(message)
    } finally {
      setBusy(false)
    }

    if (refusedAnswer) {
      throw refusedAnswer
    }
    if (commandFailed) {
      throw new Error('processing_command_not_confirmed')
    }
  }

  async function answer(
    id: string,
    input: ProcessingAnswerDto,
    key: string,
    { fromDrawer = false } = {},
  ) {
    setSaving('answer')
    try {
      // Each answer form reports itself clean once its own save is confirmed.
      await perform(() => client.answer(batch.id, id, input, key))
      // The reload remounts Processing; an open drawer comes back, focused as it would have been.
      if (sessionJobId === null) {
        drawerRestore?.disarm()
      } else {
        drawerRestore?.set({ route, jobId: sessionJobId, focusNext: fromDrawer })
      }
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
          // A chat names its session from this read and carries no revision.
          if (displayOnly || !fresh.settledAfterHintNow()) {
            throw new Error('processing_fresh_read_required')
          }
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
  // Waiting only for this mount's read is said quietly: the commands stay focusable and say why.
  const waitReason =
    waitingForRead && !displayOnly && !batch.archived && !busy && !offline ? 'Updating…' : undefined
  const runnerDisabled = disabled || unconfigured
  const subjects = new Map(
    [...batch.lots, ...batch.parts].map((subject) => [subject.id, subject.label] as const),
  )

  const subjectLabel = (id: string | null) =>
    id === null ? 'Whole batch' : (subjects.get(id) ?? 'Unknown subject')

  const liveLots = batch.lots.filter((lot) => !retiredLotIds.has(lot.id))
  const activeLotIds = new Set(liveLots.map((lot) => lot.id))
  const source = snapshot
    ? retainedJobsSource(snapshot, subjects, activeLotIds, retiredLotIds)
    : null
  const lotRows = snapshot
    ? lotSteps(snapshot.jobs, liveLots, { paused: snapshot.paused === true })
    : []
  const stage = lotStage(view)
  const focusRow = stage && lotRows.find((row) => row.lotId === focusLotId)
  const focusStep = focusRow ? focusRow.steps[stage!] : undefined
  const focusKey = focusRow ? `${view}:${focusRow.lotId}` : null
  const loaded = snapshot !== undefined
  const scrolledTo = useRef<string | null>(null)
  // Brings the focused lot's output into view once per address, after it has rendered.
  useEffect(() => {
    if (!focusKey) {
      // Leaving the focus lets a later visit to the same lot scroll to it again.
      scrolledTo.current = null
      return
    }
    if (scrolledTo.current === focusKey) {
      return
    }
    const target = document.querySelector<HTMLElement>('[data-focused-lot]')
    if (target) {
      scrolledTo.current = focusKey
      target.scrollIntoView?.({ block: 'center' })
    }
  }, [focusKey, loaded])
  const liveSessionJob = snapshot?.jobs.find((job) => job.id === sessionJobId && job.session_state)

  /** An answer form other than this source has an unsaved draft. */
  const otherAnswerDirty = (source: string) =>
    drafts.hasOtherSources('instructions', 'correction', source)

  // Drawer answers are the answer sources other than the page's.
  const unsavedInDrawer = otherAnswerDirty('answer')
  // A drawer holding an unsaved answer stays open, on the job as last read, if its session
  // leaves the read; its forms then show their questions as superseded and keep the draft.
  const [lastDrawerJob, setLastDrawerJob] = useState(liveSessionJob)
  if (liveSessionJob && liveSessionJob !== lastDrawerJob) {
    setLastDrawerJob(liveSessionJob)
  }
  const sessionJob =
    liveSessionJob ??
    (unsavedInDrawer && lastDrawerJob?.id === sessionJobId ? lastDrawerJob : undefined)
  // Every session drawer answers its questions in place (`DrawerAnswers`); a question already
  // pinned on the page is answered there and linked from the drawer.
  const answersInDrawer = sessionJob !== undefined

  // A drawer with an unsaved answer stays open until the answer is saved or discarded.
  const [closeBlocked, setCloseBlocked] = useState(false)

  // Only the live read's questions are open; a session that left has none.
  const openInDrawer = (liveSessionJob?.questions ?? []).filter(
    (question) => question.state === 'open',
  )
  const allQuestions = snapshot?.jobs.flatMap((job) => job.questions) ?? []
  if (closeBlocked && !unsavedInDrawer) {
    setCloseBlocked(false)
  }

  function questionLink(question: ProcessingQuestionDto) {
    const step = processingStepFor(sessionJob?.stage ?? '')

    return (
      <Link
        key={question.id}
        onClick={(event) => {
          // On this question's own step page the link changes no route, so it closes the drawer
          // the way Close does: never past an unsaved drawer answer.
          if (question.id === questionId && step === view) {
            if (unsavedInDrawer) {
              event.preventDefault()
              setCloseBlocked(true)
            } else {
              closeDrawer()
            }
          }
        }}
        href={batchHref(batch.id, { tab: 'processing', step, questionId: question.id })}
      >
        {questionView(question).title}
      </Link>
    )
  }

  function closeDrawer() {
    drawerRestore?.disarm()
    setCloseBlocked(false)
    setSessionJobId(null)
    // A session link's query would reopen the drawer when the batch next reloads.
    clearSessionLink()
  }

  // An open drawer whose session has left the read closes once it holds no unsaved answer: at
  // once if it held none, or when its last draft is saved or discarded. Its session link goes
  // too, so the drawer doesn't come back with the session.
  const sessionLeft =
    sessionJobId !== null &&
    snapshot !== undefined &&
    !waitingForRead &&
    !offline &&
    liveSessionJob === undefined &&
    !unsavedInDrawer
  // Each leave is its own event, so a session that leaves again has its link cleared again.
  const [leave, setLeave] = useState<{ jobId: string } | null>(null)
  if (sessionLeft) {
    setDrawer({ route, jobId: null })
    setCloseBlocked(false)
    setLeave({ jobId: sessionJobId })
  }
  // Syncs the URL with that close: a session link left in it would reopen the drawer.
  useEffect(() => {
    if (leave !== null) {
      clearSessionLink(leave.jobId)
    }
  }, [leave])

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
      <QueueActions>
        <Button
          disabled={
            !waitReason &&
            (runnerDisabled || !selected.length || snapshot.capture_revision !== batch.revision)
          }
          reasonDisplay="quiet"
          disabledReason={waitReason}
          onClick={start}
        >
          Queue new processing attempts
        </Button>
        <HelpButton
          label="About new attempts"
          explanation="A new attempt keeps the values you saved and the results of earlier attempts."
        />
      </QueueActions>
    </details>
  )
  const jobCards = (
    <>
      {jobs.map((job) => (
        <FocusTarget
          key={job.id}
          data-focused-lot={
            (focusStep?.state === 'done' && focusStep.job?.id === job.id) || undefined
          }
          data-highlighted={focusStep?.job?.id === job.id || undefined}
        >
          {focusStep?.job?.id === job.id && focusStep.partId && (
            <Small>
              {focusRow!.label} uses this output through {subjectLabel(focusStep.partId)}.
            </Small>
          )}
          <ProcessingJobCard
            key={job.id}
            job={job}
            batch={batch}
            disabled={disabled}
            paused={snapshot?.paused === true}
            waitReason={waitReason}
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
        </FocusTarget>
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
      <ReadState
        phase={fresh.phase}
        hasData={snapshot !== undefined}
        skeleton={<ProcessingSkeleton view={view} />}
      >
        {snapshot && source && (
          <>
            {view !== 'overview' && <Panel>{queue}</Panel>}
            {questionId && pinned?.question.id === questionId ? (
              <>
                <QuestionAnswer
                  key={`${pinned.question.id}:${pinned.captureRevision}`}
                  question={pinned.question}
                  captureRevision={pinned.captureRevision}
                  currentQuestion={currentQuestion}
                  currentCaptureRevision={snapshot.capture_revision}
                  disabled={
                    runnerDisabled ||
                    drafts.isDirty('instructions') ||
                    drafts.isDirty('correction') ||
                    otherAnswerDirty('answer')
                  }
                  blockedReason={
                    otherAnswerDirty('answer')
                      ? 'Save or discard the other answer first; saving it reloads Processing.'
                      : undefined
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
              // While this visit's read lands the question waits quietly; it pins once verified.
              questionId &&
              (offline || !waitingForRead) && (
                <Banner tone="warn">
                  {offline
                    ? 'The selected question cannot be opened until current state is available.'
                    : 'The pinned question is unavailable. Choose a current question explicitly.'}
                </Banner>
              )
            )}
            {view === 'overview' ? (
              <ProcessingOverview
                batchId={batch.id}
                source={source}
                onOpenSession={setSessionJobId}
                instructions={
                  <InstructionField
                    text={instructions ? instructions.text : ''}
                    revision={batch.revision}
                    instruct={fenced || !instructions?.instruct ? undefined : saveInstructions}
                    delivery={instructions?.delivery}
                    deliver={
                      fenced || !instructions?.deliver
                        ? undefined
                        : () => void instructions.deliver!()
                    }
                    locked={saving === 'answer'}
                    unavailable={instructions?.unavailable}
                    readOnlyReason={
                      batch.archived ? 'Resume the batch to change its instructions.' : undefined
                    }
                    saveBlockedReason={
                      answerDirty
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
                attention={attention}
                attentionUnavailable={attentionUnavailable}
                lots={lotRows}
                startedAt={started}
                lotsFormed={lotsFormed(batch.lots)}
                sessionLimit={sessionLimit}
                pause={pause}
              />
            ) : (
              <StepPage
                batchId={batch.id}
                step={view}
                source={source}
                summary={stepSummary(
                  view,
                  lotRows,
                  snapshot.jobs.filter((job) => onStep(job.stage, 'examine')),
                )}
                focus={
                  focusRow && focusStep
                    ? { label: focusRow.label, state: focusStep.state }
                    : undefined
                }
                onOpenSession={setSessionJobId}
                help={STEP_HELP[view]}
              >
                {view === 'images' || jobs.length > 0 ? (
                  <>
                    {view === 'images' && <ProcessingImages batchId={batch.id} client={media} />}
                    {view === 'inventory' && (
                      <ProcessingInventory
                        batch={batch}
                        jobs={jobs}
                        onOpenSession={setSessionJobId}
                      />
                    )}
                    {view === 'examine' && (
                      <ExamineView
                        batch={batch}
                        lead={jobs.find(
                          (job) => job.stage === 'examine' && job.subject_id === null,
                        )}
                        media={liveRead(mediaSnapshot) ? mediaSnapshot.data : undefined}
                        // A question on a shared Part questions every lot that uses it, as in Review.
                        questionedLots={new Set(openQuestionsByLot(snapshot, batch).keys())}
                        edit={fenced ? undefined : edit}
                        locked={answerDirty || drafts.isDirty('instructions')}
                        askSharper={askSharper}
                        askSharperReason={revisionlessReason}
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
                // A drawer restored after a remount had no opener; its session row takes focus back.
                returnFocus={() =>
                  document.querySelector<HTMLElement>(`[data-session-job="${sessionJob.id}"]`)
                }
                title={
                  <AiMark>
                    {STEP_LABEL[processingStepFor(sessionJob.stage)] ?? 'Processing'} ·{' '}
                    {subjectLabel(sessionJob.subject_id)}
                  </AiMark>
                }
                onClose={() => {
                  if (unsavedInDrawer) {
                    setCloseBlocked(true)
                  } else {
                    closeDrawer()
                  }
                }}
              >
                {closeBlocked && (
                  <div role="alert">
                    <Banner
                      tone="warn"
                      action={
                        <Button size="sm" variant="ghost" onClick={closeDrawer}>
                          Discard answer and close
                        </Button>
                      }
                    >
                      Save or discard your answer before closing this session.
                    </Banner>
                  </div>
                )}
                {openInDrawer
                  .filter((question) => !answersInDrawer || question.id === questionId)
                  .map(questionLink)}
                {answersInDrawer && (
                  <DrawerAnswers
                    questions={openInDrawer.filter((question) => question.id !== questionId)}
                    lookup={(id) => allQuestions.find((question) => question.id === id)}
                    captureRevision={snapshot.capture_revision}
                    fresh={!waitingForRead}
                    disabled={
                      runnerDisabled ||
                      drafts.isDirty('instructions') ||
                      drafts.isDirty('correction')
                    }
                    readOnly={batch.archived || saving === 'instructions'}
                    saving={saving === 'answer'}
                    isDirty={(id) => drafts.isDirty(`answer:${id}`)}
                    otherAnswerDirty={(id) => otherAnswerDirty(`answer:${id}`)}
                    answer={(id, input, key) => answer(id, input, key, { fromDrawer: true })}
                    focusNext={restored?.focusNext ?? false}
                    readFailed={offline}
                    reportFor={(id) => drafts.forSource(`answer:${id}`)}
                    fallback={questionLink}
                  />
                )}
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
      </ReadState>
    </Workspace>
  )
}

/** Drops the URL's `?session=` link, or only that session's when one is named. */
function clearSessionLink(jobId?: string) {
  const [hash, query] = location.hash.split('?')
  const linked = query ? new URLSearchParams(query).get('session') : null
  if (linked !== null && (jobId === undefined || linked === jobId)) {
    location.replace(hash)
  }
}

const NO_RETIRED_LOTS: ReadonlySet<string> = new Set()

const Workspace = styled(PageStack).attrs({ as: 'section' })``

/** A job card the address focuses: its lot's output, highlighted. */
const FocusTarget = styled.div`
  display: grid;
  gap: ${space[3]};
  border-radius: ${radius.card};
  &[data-highlighted] {
    box-shadow: 0 0 0 ${ring.width} ${color.accent};
  }
`

const QueueActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[4]};
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
