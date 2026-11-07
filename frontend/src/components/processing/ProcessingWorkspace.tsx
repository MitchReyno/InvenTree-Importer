import { IntakeRequestError } from '@invimport/contracts/client'
import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { color } from '../../theme/generated/tokens'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { serverQueryKey, useServerScope } from '../../queries/scope'
import { useRetainedPollInterval } from '../operations/LiveUpdates'
import type {
  CaptureSnapshotDto,
  ProcessingAnswerDto,
  ProcessingSnapshotDto,
  ProcessingStartDto,
} from '@invimport/contracts'
import type { ProcessingClient, ProcessingView } from '../../processing/types'
import {
  Button,
  ErrorNotice,
  Heading,
  Notice,
  Paragraph,
  Panel,
  Small,
  Summary,
} from '../ui/primitives'
import type { MediaClient } from '../../media/types'
import { ProcessingImages } from './ProcessingImages'
import { ProcessingJobCard } from './ProcessingJobCard'
import { SessionPanel } from './SessionPanel'
import { QuestionAnswer } from './QuestionAnswer'
import { ProcessingOverview } from './ProcessingOverview'
import { StepPage } from './StepPage'
import { ExamineView } from './ExamineView'
import { InstructionField } from './InstructionField'
import { Card, CardTitle, STEP_LABEL } from './ProcessingParts'
import { Modal } from '../operator/Modal'
import { batchHref, processingStepFor } from '../../navigation/batch-route'
import { retainedJobsSource } from '../../processing/source'
import { useDirtySources } from '../../operator/useDirtySources'
import type { BatchAttentionDto } from '@invimport/contracts'

/** Whether a job belongs on a Processing step; Examine covers the Reading and Identifying stages. */
function onStep(stage: string, view: ProcessingView) {
  return view === 'overview' || processingStepFor(stage) === view
}

interface Props {
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
  instructions,
}: Props) {
  const [sessionJobId, setSessionJobId] = useState<string | null>(null)
  // The answer form and the instruction field each keep the navigation guard on their own.
  const drafts = useDirtySources(onDirtyChange)
  // A save reloads Processing; the other draft is locked until that finishes.
  const [saving, setSaving] = useState<'answer' | 'instructions' | null>(null)
  // Opening a question navigates; the drawer closes only once the route actually changes.
  useEffect(() => {
    setSessionJobId(null)
  }, [questionId, view])
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
              <ReviewLink
                href={batchHref(batch.id, {
                  tab: 'review',
                  view: 'lots',
                  lotId: job.subject_id ?? undefined,
                })}
              >
                Open this lot in Review
              </ReviewLink>
            )}
        </div>
      ))}
    </>
  )

  return (
    <Workspace>
      {batch.archived && (
        <Notice role="status">
          Processing is read-only while this batch is archived. Resume it in the batch header to
          make changes.
        </Notice>
      )}
      {unconfigured && (
        <Notice role="status">
          Processing setup required. The operator must configure a persistent private runner channel
          before work can start.
        </Notice>
      )}
      <Notice>
        {snapshot?.runner_status === 'native_unverified'
          ? 'Native agent profile · requires a saved default and supervised worker. Live provider access has not been qualified.'
          : 'Synthetic processing fixture · actual provider support is not qualified.'}{' '}
        Closing this browser does not cancel saved work.
      </Notice>
      {offline && (
        <ErrorNotice role="alert">
          Processing status unavailable. The last snapshot is shown; commands are disabled.
        </ErrorNotice>
      )}
      {error && <ErrorNotice role="alert">{error}</ErrorNotice>}
      {waitingForRead && snapshot && !offline && (
        <Notice role="status">
          Verifying current processing state. Cached results cannot authorize commands.
        </Notice>
      )}
      {!snapshot || !source ? (
        <Paragraph role="status">Reading retained processing state…</Paragraph>
      ) : (
        <>
          <Panel>
            <Heading>
              {snapshot.jobs.filter((job) => job.state === 'running').length} running ·{' '}
              {snapshot.jobs.filter((job) => job.state === 'waiting_for_user').length} need answers
              · {snapshot.jobs.filter((job) => job.state === 'ready').length} ready
            </Heading>
            <Small>
              One research lane per account. A waiting question frees the lane for other lots.
            </Small>
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
          </Panel>
          {questionId && pinned?.question.id === questionId ? (
            <>
              <QuestionAnswer
                key={pinned.question.id}
                question={pinned.question}
                captureRevision={pinned.captureRevision}
                currentQuestion={currentQuestion}
                currentCaptureRevision={snapshot.capture_revision}
                disabled={runnerDisabled || drafts.isDirty('instructions')}
                readOnly={batch.archived || saving === 'instructions'}
                answer={answer}
                onDirtyChange={drafts.forSource('answer')}
              />
              {drafts.isDirty('instructions') && (
                <Small>
                  Save or discard the batch instructions first; saving the answer reloads
                  Processing.
                </Small>
              )}
            </>
          ) : (
            questionId && (
              <Notice>
                {waitingForRead || offline
                  ? 'The selected question cannot be opened until current state is available.'
                  : 'The pinned question is unavailable. Choose a current question explicitly.'}
              </Notice>
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
                      : undefined
                  }
                  onDirtyChange={drafts.forSource('instructions')}
                />
              }
              activity={
                <Card aria-label="Activity">
                  <CardTitle>Activity</CardTitle>
                  {jobs.length === 0 ? (
                    <Paragraph>
                      No retained work yet. Select saved subjects to queue an attempt.
                    </Paragraph>
                  ) : (
                    jobCards
                  )}
                </Card>
              }
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
                    />
                  )}
                  {jobCards}
                </>
              ) : undefined}
            </StepPage>
          )}
          {sessionJob && client.session && client.chat && (
            <Modal
              title={`${STEP_LABEL[processingStepFor(sessionJob.stage)] ?? 'Processing'} · ${subjectLabel(sessionJob.subject_id)}`}
              onClose={() => setSessionJobId(null)}
            >
              {sessionJob.questions
                .filter((question) => question.state === 'open')
                .map((question) => (
                  <a
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
                  </a>
                ))}
              <SessionPanel
                batchId={batch.id}
                job={sessionJob}
                client={{ session: client.session, chat: client.chat }}
                startFresh={() => restart(sessionJob)}
                freshDisabled={runnerDisabled || !client.replaceSession}
              />
            </Modal>
          )}
        </>
      )}
    </Workspace>
  )
}

const NO_RETIRED_LOTS: ReadonlySet<string> = new Set()

const ReviewLink = styled.a`
  display: inline-block;
  margin: 4px 0 8px;
  color: ${color.accent};
`

const Workspace = styled.section`
  display: grid;
  gap: 12px;
  min-width: 0;
  > ${Notice} {
    margin: 0;
    padding: 10px 12px;
    font-size: 13px;
  }
  > ${Panel} {
    margin-bottom: 0;
  }
`

const Selection = styled.fieldset`
  border: 0;
  margin: 16px 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
  label {
    display: flex;
    gap: 8px;
    align-items: center;
    min-height: 44px;
  }
`
