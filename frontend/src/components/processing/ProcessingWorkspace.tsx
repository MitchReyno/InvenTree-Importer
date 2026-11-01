import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { serverQueryKey, useServerScope } from '../../queries/scope'
import { RETAINED_POLL_INTERVAL_MS } from '../../queries/client'
import type {
  CaptureSnapshotDto,
  ProcessingAnswerDto,
  ProcessingSnapshotDto,
  ProcessingStartDto,
} from '@invimport/contracts'
import type { ProcessingClient, ProcessingView } from '../../processing/types'
import { Button, ErrorNotice, Heading, Notice, Paragraph, Panel, Small } from '../ui/primitives'
import { ProcessingJobCard } from './ProcessingJobCard'
import { QuestionAnswer } from './QuestionAnswer'

const views: ProcessingView[] = [
  'overview',
  'reading',
  'identifying',
  'research',
  'images',
  'inventory',
]

interface Props {
  batch: CaptureSnapshotDto
  client: ProcessingClient
  view: ProcessingView
  questionId?: string
  navigate: (view: ProcessingView, questionId?: string) => void
  onDirtyChange: (dirty: boolean) => void
  onSaved: () => Promise<void>
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
  navigate,
  onDirtyChange,
  onSaved,
}: Props) {
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
    refetchInterval: RETAINED_POLL_INTERVAL_MS,
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
    } catch {
      commandFailed = true
      setError(
        'Command not confirmed. Inspect retained status before deciding whether to submit another command.',
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
    await perform(() => client.answer(batch.id, id, input, key))
    onDirtyChange(false)
    try {
      await onSaved()
    } catch {
      setError(
        'Answer saved. Current capture is unavailable; refresh before making another change.',
      )
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

  const jobs = snapshot?.jobs.filter((job) => view === 'overview' || job.stage === view) ?? []
  const currentQuestion = snapshot?.jobs
    .flatMap((job) => job.questions)
    .find((question) => question.id === questionId)
  const unconfigured = snapshot?.runner_status === 'unconfigured'
  const disabled = busy || offline || waitingForRead
  const runnerDisabled = disabled || unconfigured
  return (
    <Workspace>
      <Tabs aria-label="Processing steps">
        {views.map((value) => (
          <Tab
            key={value}
            aria-current={view === value ? 'page' : undefined}
            href={`#${batch.id}/processing/${value}`}
          >
            {value[0].toUpperCase() + value.slice(1)}
          </Tab>
        ))}
      </Tabs>
      {unconfigured && (
        <Notice role="status">
          Processing setup required. The operator must configure a persistent private runner channel
          before work can start.
        </Notice>
      )}
      <Notice>
        Synthetic processing fixture · actual provider support is not qualified. Closing this
        browser does not cancel saved work.
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
      {!snapshot ? (
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
            <Selection aria-label="Select saved subjects for a new processing attempt">
              {[...batch.lots, ...batch.parts].map((subject) => (
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
              ))}
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
          </Panel>
          {questionId && pinned?.question.id === questionId ? (
            <QuestionAnswer
              key={pinned.question.id}
              question={pinned.question}
              captureRevision={pinned.captureRevision}
              currentQuestion={currentQuestion}
              currentCaptureRevision={snapshot.capture_revision}
              disabled={runnerDisabled}
              answer={answer}
              onDirtyChange={onDirtyChange}
            />
          ) : (
            questionId && (
              <Notice>
                {waitingForRead || offline
                  ? 'The selected question cannot be opened until current state is available.'
                  : 'The pinned question is unavailable. Choose a current question explicitly.'}
              </Notice>
            )
          )}
          {jobs.length === 0 && (
            <Paragraph>
              No retained work in this stage. Select saved subjects to queue an attempt.
            </Paragraph>
          )}
          {jobs.map((job) => (
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
          ))}
        </>
      )}
    </Workspace>
  )
}

const Workspace = styled.section`
  display: grid;
  gap: 12px;
  min-width: 0;
`

const Tabs = styled.nav`
  display: flex;
  gap: 6px;
  overflow-x: auto;
  border-bottom: 1px solid #d5dce5;
`

const Tab = styled.a`
  display: block;
  flex: 0 0 auto;
  min-height: 44px;
  padding: 12px;
  color: #526179;
  text-decoration: none;
  &[aria-current='page'] {
    color: #164a93;
    border-bottom: 3px solid #3977c9;
    font-weight: 600;
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
