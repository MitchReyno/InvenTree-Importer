import { useEffect, useRef, useState } from 'react'
import { subjectStatuses, type LotStatus } from '../../processing/source'
import styled from 'styled-components'
import { color } from '../../theme/generated/tokens'
import type {
  CaptureEditDto,
  CaptureSnapshotDto,
  ManualWorkspaceDto,
  MediaSnapshotDto,
  OperatorReviewDto,
  ProcessingSnapshotDto,
} from '@invimport/contracts'
import { Panel, Paragraph, Small, Notice } from '../ui/primitives'
import { Button } from '../ui/Button'
import { CaptureContextSummary } from '../capture/CaptureContextSummary'
import { ReviewQueue, visibleQueueLotIds } from './ReviewQueue'
import {
  blockingIssues,
  openWarnings,
  openQuestionsByLot,
  parseReviewLocation,
  reviewHash,
  retiredLotIds,
  type ReviewFilter,
  type ReviewLocation,
  type ReviewView,
} from '../../operator/review-model'
import type { OperatorReviewClient } from '../../operator/types'
import { useDirtySources } from '../../operator/useDirtySources'
import { retainEvidenceQuery } from '../../operator/evidence-location'
import { useReviewKeyboard } from '../../operator/useReviewKeyboard'
import { ReviewFilters } from '../operator/ReviewFilters'
import { LotEvidence } from '../operator/LotEvidence'
import { DecisionPanel } from '../operator/DecisionPanel'
import { TableWorkspace } from '../operator/TableWorkspace'
import type { CaptureWorkspaceProps } from '../../capture/types'
import type { MediaClient } from '../../media/types'
import { UnassignedObservations } from '../operator/UnassignedObservations'
import { ADD_LOT, ADD_PART, ReviewSubjectEditor } from './ReviewSubjectEditor'

interface Props {
  batch: CaptureSnapshotDto
  workspace: ManualWorkspaceDto
  operatorReview?: OperatorReviewDto
  operator?: OperatorReviewClient
  media?: MediaSnapshotDto
  mediaUnavailable?: boolean
  mediaLoading?: boolean
  processing?: ProcessingSnapshotDto
  /** True only after a successful mounted Processing read at the displayed capture revision. */
  processingCurrent?: boolean
  selected: string[]
  maxSelected: number
  busy: boolean
  stale: boolean
  toggle: (id: string) => void
  review: () => void
  reviewLots: (ids: string[]) => void
  /** Replaces the shared selection; the Table may select more than the Workspace cap. */
  setSelection: (ids: string[]) => void
  prepare: () => void
  edit: (change: CaptureEditDto['change']) => Promise<boolean | void>
  reload: () => Promise<void>
  observe?: CaptureWorkspaceProps['observe']
  mediaClient?: MediaClient
  onDirtyChange?: (dirty: boolean) => void
}

const EDIT_PARAM = 'edit'

function editParam(hash: string) {
  return new URLSearchParams(hash.split('?')[1] ?? '').get(EDIT_PARAM)
}

/** Adds or removes the open subject editor from a Review hash, keeping other parameters. */
export function withEditParam(hash: string, subjectId: string | null) {
  const [path, query = ''] = hash.split('?')
  const params = new URLSearchParams(query)
  if (subjectId) {
    params.set(EDIT_PARAM, subjectId)
  } else {
    params.delete(EDIT_PARAM)
  }
  const next = params.toString()
  return `${path}${next ? `?${next}` : ''}`
}

function initialEditor(batch: CaptureSnapshotDto) {
  const value = editParam(location.hash)
  const known = [...batch.lots, ...batch.parts].some((subject) => subject.id === value)
  return value && (known || value === ADD_LOT || value === ADD_PART) ? value : null
}

function initialLocation(batch: CaptureSnapshotDto): ReviewLocation {
  const parsed = parseReviewLocation(location.hash)
  const known = batch.lots.some((lot) => lot.id === parsed.lotId)
  return { ...parsed, lotId: known ? parsed.lotId : null }
}

/** Why the selected scope cannot be marked reviewed yet, if anything. */
function selectionProblem(
  selected: string[],
  workspace: ManualWorkspaceDto,
  operatorReview: OperatorReviewDto | undefined,
  maxSelected: number,
) {
  if (!selected.length) {
    return null
  }
  if (selected.length > maxSelected) {
    return `Select at most ${maxSelected} lots to review or prepare together.`
  }
  if (operatorReview) {
    const lots = operatorReview.lots.filter((lot) => selected.includes(lot.lot_id))
    if (lots.length !== selected.length) {
      return 'A selected lot was split or merged; reselect from the current lots.'
    }
    if (lots.some((lot) => blockingIssues(lot).length)) {
      return 'Fix blocking problems in the selected lots first.'
    }
    if (lots.some((lot) => openWarnings(lot).length)) {
      return 'Fix or dismiss warnings in the selected lots first.'
    }
    return null
  }
  const statuses = workspace.lots.filter((value) => selected.includes(value.lot_id))
  return statuses.some((value) => value.issues.length > 0)
    ? 'Fix blocking problems in the selected lots first.'
    : null
}

function scopeReviewed(
  selected: string[],
  workspace: ManualWorkspaceDto,
  operatorReview?: OperatorReviewDto,
) {
  if (!selected.length) {
    return false
  }
  if (operatorReview) {
    const lots = operatorReview.lots.filter((lot) => selected.includes(lot.lot_id))
    return lots.length === selected.length && lots.every((lot) => lot.review_state === 'reviewed')
  }
  const statuses = workspace.lots.filter((value) => selected.includes(value.lot_id))
  return statuses.length === selected.length && statuses.every((value) => value.reviewed)
}

/** Review remounts after each save; history state keeps a return to the list across them. */
const LIST_CHOSEN = 'reviewListChosen'

function listChosen() {
  return (history.state as Record<string, unknown> | null)?.[LIST_CHOSEN] === true
}

/** Rewrites the URL, keeping the list choice unless it is being set or cleared. */
function writeHash(hash: string, chosen = listChosen()) {
  history.replaceState(chosen ? { [LIST_CHOSEN]: true } : null, '', hash)
}

export function ReviewWorkspace({
  batch,
  workspace,
  operatorReview: observedOperatorReview,
  operator,
  media,
  mediaUnavailable,
  mediaLoading,
  processing,
  processingCurrent = false,
  selected,
  maxSelected,
  busy,
  stale,
  toggle,
  review,
  reviewLots,
  setSelection,
  prepare,
  edit,
  reload,
  observe,
  mediaClient,
  onDirtyChange,
}: Props) {
  const [acceptedOperatorReview, setAcceptedOperatorReview] = useState(
    observedOperatorReview?.revision === batch.revision ? observedOperatorReview : undefined,
  )
  const currentOperatorReview =
    observedOperatorReview?.revision === batch.revision ? observedOperatorReview : undefined
  const operatorReview = currentOperatorReview ?? acceptedOperatorReview
  const reviewUnavailable = operator !== undefined && currentOperatorReview === undefined
  useEffect(() => {
    if (currentOperatorReview) {
      setAcceptedOperatorReview(currentOperatorReview)
    }
  }, [currentOperatorReview])
  const drafts = useDirtySources(onDirtyChange)
  const [navigationBlocked, setNavigationBlocked] = useState(false)
  const [route, setRoute] = useState(() => initialLocation(batch))
  const [editSignal, setEditSignal] = useState(0)
  const [editing, setEditing] = useState(() => initialEditor(batch))
  const evidenceRef = useRef<HTMLElement>(null)
  const queueRef = useRef<HTMLDivElement>(null)
  const previousFocus = useRef(route.lotId)
  const retired = retiredLotIds(operatorReview, batch)
  const activeLotIds = batch.lots.filter((lot) => !retired.has(lot.id)).map((lot) => lot.id)
  const openQuestions = openQuestionsByLot(processing, batch)
  const agentLines = processing ? subjectStatuses(processing) : new Map<string, LotStatus>()
  const visibleIds = visibleQueueLotIds(batch, operatorReview, route.filter, openQuestions)
  const focused = route.lotId && activeLotIds.includes(route.lotId) ? route.lotId : null

  // Review opens on the first queued lot, so its evidence shows without a separate step.
  const autoShown = useRef(false)
  useEffect(() => {
    if (
      autoShown.current ||
      listChosen() ||
      route.view !== 'evidence' ||
      focused ||
      !visibleIds.length
    ) {
      return
    }
    autoShown.current = true
    navigate({ lotId: visibleIds[0] })
  })

  useEffect(() => {
    if (focused) {
      evidenceRef.current?.focus({ preventScroll: true })
    } else if (previousFocus.current) {
      queueRef.current?.focus({ preventScroll: true })
    }
    previousFocus.current = focused
  }, [focused])

  function navigate(next: Partial<ReviewLocation>): boolean {
    if (drafts.isDirty()) {
      setNavigationBlocked(true)
      return false
    }
    setNavigationBlocked(false)
    const value = { ...route, ...next }
    setRoute(value)
    const sameLot = value.lotId === route.lotId
    const hash = sameLot
      ? retainEvidenceQuery(reviewHash(batch.id, value), location.hash)
      : reviewHash(batch.id, value)
    writeHash(withEditParam(hash, editing))
    return true
  }

  function openEditor(subjectId: string) {
    if (drafts.isDirty()) {
      setNavigationBlocked(true)
      return
    }
    setNavigationBlocked(false)
    setEditing(subjectId)
    writeHash(withEditParam(location.hash, subjectId))
  }

  function closeEditor() {
    drafts.forSource('subject')(false)
    setEditing(null)
    writeHash(withEditParam(location.hash, null))
  }

  function retainEditorRoute(retain: boolean) {
    writeHash(withEditParam(location.hash, retain ? editing : null))
  }

  function inspect(id: string | null) {
    if (navigate({ lotId: id, view: id ? 'evidence' : route.view })) {
      writeHash(location.hash, id === null)
    }
  }

  function move(offset: number) {
    if (!visibleIds.length) {
      return
    }
    const index = focused ? visibleIds.indexOf(focused) : -1
    const nextIndex = Math.min(Math.max(index + offset, 0), visibleIds.length - 1)
    inspect(visibleIds[nextIndex])
  }

  useReviewKeyboard(
    {
      next: () => move(1),
      previous: () => move(-1),
      markReviewed: () => {
        if (
          focused &&
          !drafts.isDirty() &&
          !reviewUnavailable &&
          !busy &&
          !stale &&
          !selectionProblem([focused], workspace, operatorReview, maxSelected)
        ) {
          reviewLots([focused])
        }
      },
      editQuantity: () => {
        if (focused) {
          setEditSignal((value) => value + 1)
        }
      },
      viewEvidence: () => evidenceRef.current?.focus(),
    },
    route.view === 'evidence',
  )

  const lot = batch.lots.find((value) => value.id === focused)
  const part = batch.parts.find((value) => value.id === lot?.part_subject_id)
  const operatorLot = operatorReview?.lots.find((value) => value.lot_id === lot?.id)
  const problem = selectionProblem(selected, workspace, operatorReview, maxSelected)
  const reviewed = scopeReviewed(selected, workspace, operatorReview)
  return (
    <>
      {navigationBlocked && drafts.dirty && (
        <Notice role="status">
          Save or explicitly discard local edits before switching lots or views.
        </Notice>
      )}
      {reviewUnavailable && (
        <Notice role="status">
          Current operator review is unavailable or changed. Local drafts and exact retry intents
          are retained; reload saved values deliberately before new commands.
        </Notice>
      )}
      <CaptureContextSummary batch={batch} subjectId={focused ?? undefined} />
      <ScopeBar>
        <div>
          <strong>{selected.length} selected</strong>
          <Small>{activeLotIds.length - selected.length} remain outside this scope.</Small>
          {problem && <Small role="status">{problem}</Small>}
        </div>
        <Button
          disabled={
            drafts.dirty ||
            reviewUnavailable ||
            busy ||
            stale ||
            Boolean(problem) ||
            !selected.length
          }
          onClick={review}
        >
          Mark selected reviewed
        </Button>
        <Button
          disabled={
            drafts.dirty || reviewUnavailable || busy || stale || Boolean(problem) || !reviewed
          }
          onClick={prepare}
        >
          Prepare exact selected effects
        </Button>
      </ScopeBar>
      {!workspace.supported && (
        <Notice>
          Adding stock isn’t available for this target, so lots can be reviewed but not added.
        </Notice>
      )}
      <SubjectActions aria-label="Manual subjects">
        <Button
          type="button"
          disabled={busy || batch.archived || !observe || drafts.dirty}
          onClick={() => openEditor(ADD_LOT)}
        >
          Add physical lot
        </Button>
        <Button
          type="button"
          disabled={busy || batch.archived || !observe || drafts.dirty}
          onClick={() => openEditor(ADD_PART)}
        >
          Add shared Part proposal
        </Button>
        {lot && (
          <Button
            type="button"
            disabled={busy || batch.archived || !observe || drafts.dirty}
            onClick={() => openEditor(lot.id)}
          >
            Edit lot details
          </Button>
        )}
        {part && (
          <Button
            type="button"
            disabled={busy || batch.archived || !observe || drafts.dirty}
            onClick={() => openEditor(part.id)}
          >
            Edit shared Part
          </Button>
        )}
        {/* A Part linked to no lot has no lot to focus, so it keeps its own entry point. */}
        {batch.parts
          .filter((item) => !batch.lots.some((value) => value.part_subject_id === item.id))
          .map((item) => (
            <Button
              key={item.id}
              type="button"
              disabled={busy || batch.archived || !observe || drafts.dirty}
              onClick={() => openEditor(item.id)}
            >
              Edit unlinked shared Part: {item.label}
            </Button>
          ))}
      </SubjectActions>
      {editing && observe && (
        <ReviewSubjectEditor
          batch={batch}
          subjectId={editing}
          subjectDisabled={busy || stale || batch.archived || drafts.hasOtherSources('subject')}
          attachmentDisabled={
            busy || stale || batch.archived || drafts.hasOtherSources('attachment')
          }
          dirty={drafts.dirty}
          edit={edit}
          observe={observe}
          media={mediaClient}
          onDirtyChange={drafts.forSource('subject')}
          onAttachmentDirtyChange={drafts.forSource('attachment')}
          reload={reload}
          onClose={closeEditor}
          retainRoute={retainEditorRoute}
        />
      )}
      {operatorReview && (
        <Toolbar>
          <ModeSwitch role="tablist" aria-label="Review view">
            {(['evidence', 'table'] as ReviewView[]).map((view) => (
              <ModeTab
                key={view}
                type="button"
                role="tab"
                aria-selected={route.view === view}
                onClick={() => navigate({ view })}
              >
                {view === 'evidence' ? 'Evidence' : 'Table'}
              </ModeTab>
            ))}
          </ModeSwitch>
          <KeyboardHint>
            J/K move · R mark reviewed · E edit quantity · V view evidence
          </KeyboardHint>
        </Toolbar>
      )}
      {operatorReview && (
        <ReviewFilters
          review={operatorReview}
          filter={route.filter}
          questionLotIds={openQuestions}
          questionsKnown={processing !== undefined}
          choose={(filter: ReviewFilter) => navigate({ filter })}
        />
      )}
      {route.filter === 'needs_answer' && processing === undefined && (
        <Small role="status">
          Open questions have not been read from Processing, so this list may be incomplete.
        </Small>
      )}
      {operatorReview && operator && route.view === 'table' ? (
        <TableWorkspace
          batch={batch}
          review={operatorReview}
          client={operator}
          media={mediaUnavailable ? undefined : media}
          lotIds={route.filter === 'retired' ? [] : visibleIds}
          activeLotIds={activeLotIds}
          disabled={busy || stale || reviewUnavailable || drafts.hasOtherSources('workspace')}
          maxReviewLots={maxSelected}
          selected={selected}
          setSelection={setSelection}
          inspect={inspect}
          reviewLots={reviewLots}
          reload={reload}
          onDirtyChange={drafts.forSource('workspace')}
        />
      ) : (
        <ReviewGrid $focused={Boolean(lot)}>
          <QueueFocus ref={queueRef} tabIndex={-1} data-area="queue">
            <ReviewQueue
              batch={batch}
              workspace={workspace}
              operatorReview={operatorReview}
              filter={route.filter}
              lotIds={visibleIds}
              selected={selected}
              focused={focused}
              busy={busy || reviewUnavailable}
              maxSelected={maxSelected}
              toggle={toggle}
              inspect={inspect}
            />
          </QueueFocus>
          {lot && (
            <BackButton data-area="back" onClick={() => inspect(null)}>
              ← Physical lots and selection
            </BackButton>
          )}
          <Panel data-area="evidence" ref={evidenceRef} tabIndex={-1} aria-label="Human evidence">
            {lot ? (
              <LotEvidence
                batch={batch}
                lot={lot}
                part={part}
                operatorLot={operatorLot}
                media={media}
                mediaUnavailable={mediaUnavailable}
                mediaLoading={mediaLoading}
                processing={processing}
                processingCurrent={processingCurrent}
                edit={edit}
                // Accepting remounts Review at the new revision, so any open draft fences it.
                editDisabled={busy || stale || batch.archived || drafts.dirty}
              />
            ) : (
              <Paragraph>Choose a lot to compare its evidence and saved choices.</Paragraph>
            )}
            {/* Review always opens a lot, so observations in no lot are listed beside it. */}
            <UnassignedObservations
              batch={batch}
              edit={edit}
              disabled={busy || stale || batch.archived || drafts.dirty}
            />
          </Panel>
          <Panel data-area="details" aria-label="Decision">
            {lot ? (
              <DecisionPanel
                key={lot.id}
                batch={batch}
                lot={lot}
                part={part}
                workspace={workspace}
                operatorLot={operatorLot}
                media={mediaUnavailable ? undefined : media}
                activeLotIds={activeLotIds}
                operator={operator}
                disabled={
                  busy ||
                  stale ||
                  reviewUnavailable ||
                  batch.archived ||
                  drafts.hasOtherSources('workspace')
                }
                edit={edit}
                reload={reload}
                inspect={inspect}
                markReviewed={() => reviewLots([lot.id])}
                openQuestion={openQuestions.get(lot.id) ?? null}
                agent={agentLines.get(lot.id) ?? null}
                editPart={openEditor}
                editSignal={editSignal}
                onDirtyChange={drafts.forSource('workspace')}
              />
            ) : (
              <Paragraph>
                Marking reviewed changes no inventory. Preparation performs bounded read-only
                checks, then freezes the selected effects.
              </Paragraph>
            )}
          </Panel>
        </ReviewGrid>
      )}
    </>
  )
}

const ScopeBar = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 8px;
  padding: 6px 10px;
  background: ${color.surface};
  border: 1px solid ${color.line};
  border-radius: 6px;
  > div {
    margin-right: auto;
  }
  @media (max-width: 700px) {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
    > div {
      grid-column: 1 / -1;
      margin-right: 0;
    }
    > button {
      min-width: 0;
      width: 100%;
      padding: 6px 8px;
      font-size: 13px;
      line-height: 1.3;
    }
  }
`
const SubjectActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
`
const KeyboardHint = styled(Small)`
  @media (max-width: 700px) {
    display: none;
  }
`
const Toolbar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-bottom: 6px;
`
const ModeSwitch = styled.div`
  display: inline-flex;
  border: 1px solid ${color.lineStrong};
  border-radius: 6px;
  overflow: hidden;
`
const ModeTab = styled.button`
  min-height: 40px;
  padding: 8px 16px;
  border: 0;
  background: ${color.surface};
  color: ${color.fg};
  cursor: pointer;
  &[aria-selected='true'] {
    background: ${color.accentWeak};
    color: ${color.accent};
    font-weight: 600;
  }
`
const ReviewGrid = styled.div<{ $focused: boolean }>`
  display: grid;
  grid-template-columns: minmax(200px, 0.75fr) minmax(320px, 1.6fr) minmax(300px, 1.3fr);
  gap: 12px;
  align-items: start;
  @media (max-width: 1000px) {
    grid-template-columns: minmax(180px, 0.8fr) minmax(260px, 1.2fr);
    [data-area='evidence'] {
      grid-column: 2;
    }
    [data-area='details'] {
      grid-column: 2;
    }
    [data-area='queue'] {
      grid-column: 1;
      grid-row: 1/3;
    }
  }
  @media (max-width: 700px) {
    display: block;
    [data-area='queue'] {
      display: ${(p) => (p.$focused ? 'none' : 'block')};
    }
    [data-area='evidence'],
    [data-area='details'] {
      display: ${(p) => (p.$focused ? 'block' : 'none')};
    }
  }
`
const BackButton = styled(Button)`
  display: none;
  @media (max-width: 700px) {
    display: block;
    margin-bottom: 12px;
  }
`
const QueueFocus = styled.div`
  min-width: 0;
`
