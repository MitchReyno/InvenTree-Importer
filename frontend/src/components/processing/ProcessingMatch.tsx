import { useRef, useState } from 'react'
import styled from 'styled-components'
import { useQueryClient } from '@tanstack/react-query'
import { IntakeRequestError } from '@invimport/contracts/client'
import type {
  CaptureSnapshotDto,
  MatchAnswerDto,
  MatchBatchAnswerDto,
  MatchQuestionDto,
} from '@invimport/contracts'
import { Banner, Button, onField, PageStack, Pill, ReadState } from '#/components/ui'
import { useRetainedPollInterval, useServerScope } from '#/context'
import { batchHref } from '#/navigation/batch-route'
import {
  BATCH_ADD_STOCK_OPTION,
  batchAddStockQuestions,
  matchCommandFailure,
  matchStanding,
} from '#/processing/match-question'
import { identitySource, matchSummary } from '#/processing/match-view'
import type { ProcessingClient } from '#/processing/types'
import { serverQueryKey } from '#/queries/scope'
import { useFreshRead } from '#/queries/useFreshRead'
import { color, space, type, typeVar } from '#/theme/generated/tokens'
import { MatchBatchAnswer } from './MatchBatchAnswer'
import { MatchQuestionForm } from './MatchQuestionForm'
import { MatchQuestionOutcome } from './MatchQuestionOutcome'
import { MatchTable, type MatchRow } from './MatchTable'
import { ProcessingSkeleton } from './ProcessingSkeleton'
import { Card } from './ProcessingParts'

type Props = {
  batch: CaptureSnapshotDto
  client: ProcessingClient
  /** The match question the address names, shown above the table. */
  questionId?: string
  retiredLotIds: ReadonlySet<string>
  /** Shown from restored snapshots: nothing can be sent. */
  displayOnly: boolean
  /** The answer form has an unsaved draft. */
  dirty: boolean
  onDirtyChange: (dirty: boolean) => void
  /** Reloads the batch once an answer moved its capture revision. */
  onSaved: () => Promise<void>
}

/** What a command in flight is for: a lot's row, Check again for every lot, or an answer. */
type Busy = { kind: 'lot'; lotId: string } | { kind: 'check' } | { kind: 'answer' } | null

/**
 * Processing › Match for a batch on `/7`'s pipeline: each lot with what Match searched it by, its
 * result and what Research and Images run in which mode. Match has no sessions, so its question
 * and candidates show here, where other steps open a session drawer.
 */
export function ProcessingMatch({
  batch,
  client,
  questionId,
  retiredLotIds,
  displayOnly,
  dirty,
  onDirtyChange,
  onSaved,
}: Props) {
  const scope = useServerScope()
  const queryClient = useQueryClient()
  const pollInterval = useRetainedPollInterval()
  // Under the batch's Processing key, so the live hints and polls that refresh Processing refresh it.
  const fresh = useFreshRead({
    queryKey: serverQueryKey(scope, 'processing', batch.id, 'match'),
    queryFn: () => client.match!(batch.id),
    enabled: client.match !== undefined,
    refetchInterval: pollInterval,
  })
  const match = fresh.data
  const [pinned, setPinned] = useState<MatchQuestionDto | null>(null)
  const [answeredHere, setAnsweredHere] = useState<ReadonlySet<string>>(() => new Set())
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState('')
  // A command's key is kept until it is confirmed or refused, so a retry can't apply it twice.
  const keys = useRef(new Map<string, string>())

  const routed = questionId ? match?.questions.find((item) => item.id === questionId) : undefined
  // Pins the first open read of the named question; polling never swaps the form's question.
  if (!questionId) {
    if (pinned) {
      setPinned(null)
    }
  } else if (
    pinned?.id !== questionId &&
    routed?.state === 'open' &&
    fresh.verified &&
    !answeredHere.has(routed.id)
  ) {
    setPinned(routed)
  }

  if (!client.match) {
    return (
      <Banner tone="plain">
        Match isn’t available in this setup, so nothing is searched here.
      </Banner>
    )
  }

  const fenced = batch.archived || displayOnly
  const failed = fresh.phase === 'failed'
  const answerReady = !fenced && !busy && fresh.commandsReady
  // Check again and Decide again carry no revision, so they wait for a read after the last hint.
  const revisionlessReason = revisionlessUnavailable()

  function revisionlessUnavailable() {
    if (batch.archived) {
      return 'Resume the batch to change its matches.'
    }
    if (displayOnly || busy || !fresh.settledAfterHint) {
      return fresh.reason ?? 'Updating…'
    }
    return undefined
  }

  const lotLabel = (lotId: string) =>
    batch.lots.find((lot) => lot.id === lotId)?.label ?? 'This lot'

  const liveLots = batch.lots.filter((lot) => !retiredLotIds.has(lot.id))
  const rows: MatchRow[] = liveLots.map((lot) => ({
    lotId: lot.id,
    label: lot.label,
    match: match?.lots.find((item) => item.lot_id === lot.id),
  }))
  const searched = rows.flatMap((row) => (row.match ? [row.lotId] : []))
  const summary = matchSummary(rows.flatMap((row) => (row.match ? [row.match] : [])))
  const batchQuestions = batchAddStockQuestions(match?.questions ?? []).filter(
    (question) => !answeredHere.has(question.id),
  )

  /** Reads Processing and Match again after a command, whatever its outcome. */
  async function refresh() {
    await queryClient.invalidateQueries({
      queryKey: serverQueryKey(scope, 'processing', batch.id),
    })
  }

  /** An answer that moved the capture revision bound a lot's target; the batch reloads for it. */
  async function afterAnswer(captureRevision: string) {
    await refresh()
    if (captureRevision !== batch.revision) {
      await onSaved().catch(() => {})
    }
  }

  /**
   * Sends a revisionless command once under a key kept for its intent until the server confirms
   * or refuses it; an unknown outcome keeps the key, so pressing again can't apply it twice.
   */
  async function run(intent: string, target: Busy, work: (key: string) => Promise<unknown>) {
    if (fenced || busy || !fresh.settledAfterHintNow()) {
      return
    }
    const key = keys.current.get(intent) ?? crypto.randomUUID()
    keys.current.set(intent, key)
    setBusy(target)
    setError('')
    try {
      await work(key)
      keys.current.delete(intent)
    } catch (failure) {
      if (failure instanceof IntakeRequestError && failure.status < 500) {
        keys.current.delete(intent)
      }
      setError(matchCommandFailure(failure))
    } finally {
      setBusy(null)
    }
    await refresh()
  }

  function checkAgain(lotIds: string[]) {
    if (!client.checkMatches || lotIds.length === 0) {
      return
    }
    const input = { lot_ids: lotIds }
    const target: Busy = lotIds.length === 1 ? { kind: 'lot', lotId: lotIds[0] } : { kind: 'check' }
    void run(`check:${lotIds.join(',')}`, target, (key) =>
      client.checkMatches!(batch.id, input, key),
    )
  }

  function decideAgain(lotId: string) {
    if (!client.reopenMatch) {
      return
    }
    void run(`reopen:${lotId}`, { kind: 'lot', lotId }, (key) =>
      client.reopenMatch!(batch.id, lotId, key),
    )
  }

  function addStockToEach() {
    if (!client.answerMatches || !fresh.commandsReadyNow()) {
      return
    }
    const input: MatchBatchAnswerDto = {
      answers: batchQuestions.map((question) => ({
        question_id: question.id,
        expected_question_revision: question.revision,
        option_id: BATCH_ADD_STOCK_OPTION,
      })),
    }
    void run(`batch:${JSON.stringify(input)}`, { kind: 'answer' }, async (key) => {
      const receipt = await client.answerMatches!(batch.id, input, key)
      setAnsweredHere((previous) => new Set([...previous, ...receipt.question_ids]))
      await afterAnswer(receipt.capture_revision)
    })
  }

  async function answer(id: string, input: MatchAnswerDto, key: string) {
    setBusy({ kind: 'answer' })
    try {
      const receipt = await client.answerMatch!(batch.id, id, input, key)
      setAnsweredHere((previous) => new Set([...previous, id]))
      await afterAnswer(receipt.capture_revision)
    } catch (failure) {
      // A refused answer's question may have been replaced; the form keeps the draft meanwhile.
      void refresh()
      throw failure
    } finally {
      setBusy(null)
    }
  }

  /** The question the address names: its form while it can take an answer, else its outcome. */
  function questionArea() {
    if (!questionId || !match) {
      return null
    }
    const here = answeredHere.has(questionId)
    if (pinned && pinned.id === questionId) {
      const standing = matchStanding(pinned, routed, here)
      // An unsaved draft keeps its form, warning that it can't be sent, until it is discarded.
      if (standing === 'open' || (dirty && standing !== 'answered_here')) {
        const lot = match.lots.find((item) => item.lot_id === pinned.lot_id)
        return (
          <MatchQuestionForm
            key={pinned.id}
            question={pinned}
            current={routed}
            answeredHere={here}
            lot={lotLabel(pinned.lot_id)}
            source={identitySource(lot)}
            disabled={!answerReady || !client.answerMatch}
            readOnly={batch.archived}
            onDirtyChange={onDirtyChange}
            answer={answer}
          />
        )
      }
    }
    if (routed && routed.state !== 'open') {
      const newer = match.lots.find((item) => item.lot_id === routed.lot_id)?.question_id
      return (
        <MatchQuestionOutcome
          question={routed}
          savedHere={here}
          newerHref={
            newer && newer !== routed.id
              ? batchHref(batch.id, { tab: 'processing', step: 'match', questionId: newer })
              : undefined
          }
        />
      )
    }
    if (routed && here) {
      return <MatchQuestionOutcome question={routed} savedHere />
    }
    if (!routed && (fresh.verified || failed)) {
      return (
        <Banner tone="warn">
          {failed
            ? 'The match question can’t be opened until Match can be read.'
            : 'This match question is no longer asked. Choose a current one from the table.'}
        </Banner>
      )
    }
    return null
  }

  return (
    <Page aria-label="Match">
      <Head>
        <div>
          <Title>Match: is this already in InvenTree?</Title>
          <FieldNote>
            The app searches InvenTree and this app’s other batches with each lot’s identity ·{' '}
            {liveLots.length === 1 ? '1 lot' : `${liveLots.length} lots`}
          </FieldNote>
        </div>
        {client.checkMatches && (
          <Button
            size="sm"
            busy={busy?.kind === 'check'}
            disabled={searched.length === 0}
            disabledReason={revisionlessReason}
            reasonDisplay="quiet"
            onClick={() => checkAgain(searched)}
          >
            Check InvenTree again
          </Button>
        )}
      </Head>
      {match && (
        <Pills aria-label="Match summary">
          {summary.needYou > 0 && (
            <Pill tone="warn" glyph="?">
              {summary.needYou} need you
            </Pill>
          )}
          {summary.existing > 0 && (
            <Pill tone="ok">
              {summary.existing} existing {summary.existing === 1 ? 'Part' : 'Parts'}
            </Pill>
          )}
          {summary.fresh > 0 && <Pill tone="info">{summary.fresh} new</Pill>}
          {summary.searching > 0 && (
            <Pill tone="outline" glyph="…">
              {summary.searching} searching
            </Pill>
          )}
          {summary.unavailable > 0 && (
            <Pill tone="bad" glyph="!">
              {summary.unavailable} couldn’t search
            </Pill>
          )}
        </Pills>
      )}
      {error && (
        <div role="alert">
          <Banner tone="bad">{error}</Banner>
        </div>
      )}
      <ReadState
        phase={fresh.phase}
        hasData={match !== undefined}
        skeleton={<ProcessingSkeleton view="match" />}
        failure={
          <div role="alert">
            <Banner tone="bad">
              Match status unavailable. The last read is shown; its commands are disabled.
            </Banner>
          </div>
        }
      >
        {match && (
          <>
            {questionArea()}
            {!questionId && batchQuestions.length >= 2 && client.answerMatches && (
              <MatchBatchAnswer
                batchId={batch.id}
                questions={batchQuestions}
                lotLabel={lotLabel}
                unavailableReason={answerReady ? undefined : (fresh.reason ?? 'Updating…')}
                busy={busy?.kind === 'answer'}
                addStockToEach={addStockToEach}
              />
            )}
            <Card aria-label="Lots and their matches">
              <MatchTable
                batchId={batch.id}
                rows={rows}
                questions={match.questions}
                unavailableReason={revisionlessReason}
                busyLot={busy?.kind === 'lot' ? busy.lotId : null}
                searchAgain={(lotId) => checkAgain([lotId])}
                decideAgain={decideAgain}
              />
            </Card>
          </>
        )}
      </ReadState>
    </Page>
  )
}

const Page = styled(PageStack).attrs({ as: 'section' })``

const Head = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: ${space[4]};
  > div {
    display: grid;
    gap: ${space[1]};
  }
`

const Title = styled.h2`
  margin: 0;
  ${type.h2}
  ${onField}
`

/** Text placed directly on the page, which takes a ground patch behind the whole window. */
const FieldNote = styled.span`
  font-size: ${typeVar.small.size};
  color: ${color.muted};
  ${onField}
`

const Pills = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[3]};
`
