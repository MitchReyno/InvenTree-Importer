import { useEffect, useState } from 'react'
import { Banner } from '../ui/Banner'
import styled from 'styled-components'
import { color, space, typeVar } from '../../theme/generated/tokens'
import type {
  CaptureEditDto,
  CaptureSnapshotDto,
  ManualWorkspaceDto,
  MediaSnapshotDto,
  OperatorLotDto,
  ProcessingAnswerDto,
} from '@invimport/contracts'
import { useDirtySources } from '../../operator/useDirtySources'
import { display } from '../../capture/display'
import {
  lotLocationFact,
  lotProvenance,
  partProvenance,
  type OpenQuestion,
} from '../../operator/review-model'
import type { OperatorReviewClient } from '../../operator/types'
import { Heading, Link, Paragraph, Small } from '../ui/primitives'
import { Button } from '../ui/Button'
import { Kbd } from '../ui/Kbd'
import { QuestionAnswer } from '../processing/QuestionAnswer'
import { StickyFooter } from '../ui/StickyFooter'
import { CompareMatches } from './CompareMatches'
import { KeyValue } from '../ui/KeyValue'
import { ProvenancePill } from './ProvenancePill'
import { SourceChip } from '../ui/SourceChip'
import { partFacts, type PartFacts } from '../../operator/part-facts'
import type { KeyValueRow } from '../ui/KeyValue'
import { SharedTagsChoice } from './SharedTagsChoice'
import { IssuePanel } from './IssuePanel'
import { QUICK_QUANTITY_INPUT_ID, QuickLotEdit } from './QuickLotEdit'
import { ExcludeForm } from './ExcludeLot'
import { RestructureDialog, type RestructureKind } from './RestructureDialog'
import { batchHref } from '../../navigation/batch-route'
import { RecordChain, type RecordLink } from '../ui/RecordChain'
import { AgentLine } from './AgentLine'
import type { LotStatus } from '../../processing/source'
import { problemActions } from '../../operator/problem-actions'
import type { Provenance } from '../../operator/review-model'

type Lot = CaptureSnapshotDto['lots'][number]
type Part = CaptureSnapshotDto['parts'][number]

interface Props {
  batch: CaptureSnapshotDto
  lot: Lot
  part: Part | undefined
  workspace: ManualWorkspaceDto
  operatorLot?: OperatorLotDto
  /** Evidence group membership for group location assignments; undefined while unread. */
  media?: Pick<MediaSnapshotDto, 'evidence' | 'groups'>
  /** Active lot IDs, used for shared-Part counts and impact previews. */
  activeLotIds: string[]
  operator?: OperatorReviewClient
  disabled: boolean
  edit: (change: CaptureEditDto['change']) => Promise<boolean | void>
  reload: () => Promise<void>
  inspect: (lotId: string) => void
  /** The lot's open Processing question, which problems can offer to answer. */
  openQuestion?: OpenQuestion | null
  /** Answers the open question in place, queued to the asking session. */
  answerQuestion?: (questionId: string, input: ProcessingAnswerDto, key: string) => Promise<void>
  /** Marks this one lot reviewed; refused while it has unresolved problems. */
  markReviewed?: () => void
  /** Opens Review's shared Part editor for this Part. */
  /** Opens the subject editor for a lot or Part; also the lot's "Edit lot details". */
  editPart?: (partId: string) => void
  /** Locks the subject editor entry points (no observe client, archived or unsaved work). */
  subjectsDisabled?: boolean
  /** Moves focus to the lot's evidence, where a proposed value's source is shown. */
  openEvidence?: () => void
  /** Increments when the operator asks to edit quantity (E). */
  editSignal?: number
  /** The lot's latest agent status line, where a session works on it. */
  agent?: LotStatus | null
  onDirtyChange?: (dirty: boolean) => void
}

/** Why this lot cannot be marked reviewed yet, in words; null when it can. */
function reviewBlockReason(lot: OperatorLotDto | undefined) {
  if (!lot) {
    return null
  }
  if (lot.excluded) {
    return 'Include it again to review it'
  }
  if (lot.approved) {
    return 'Already added'
  }
  if (lot.review_state === 'reviewed') {
    return 'Already reviewed'
  }
  const blocking = lot.issues.filter((issue) => issue.severity === 'blocking').length
  if (blocking) {
    return `Fix ${blocking} blocking ${blocking === 1 ? 'problem' : 'problems'} first`
  }
  const warnings = lot.issues.filter(
    (issue) => issue.severity === 'warning' && !issue.disposition,
  ).length
  if (warnings) {
    return `Dismiss or fix ${warnings} ${warnings === 1 ? 'warning' : 'warnings'} first`
  }
  return null
}

/** The InvenTree records this lot becomes, each opening Review › Records. */
export function recordLinks(
  batch: CaptureSnapshotDto,
  lot: Lot,
  part: Part | undefined,
  operatorLot: OperatorLotDto | undefined,
  location: { value: string; provenance: Provenance },
): RecordLink[] {
  const records = batchHref(batch.id, { tab: 'review', view: 'records' })
  const partState: RecordLink['state'] =
    part?.choice.mode === 'set' ? 'exists' : part?.choice.mode === 'create' ? 'new' : 'choose'
  const partLabel =
    part?.choice.mode === 'create' ? part.choice.spec.name : (part?.label ?? 'Not chosen')
  const located = !(
    ['unset', 'unknown', 'cleared', 'unconfirmed', 'conflict'] as Provenance[]
  ).includes(location.provenance)
  // A batch location draft is only created at approval, so it is new, not existing.
  const draft = location.value.endsWith('created only after approval')

  return [
    { kind: 'Part', label: partLabel, state: partState, href: records },
    {
      kind: 'Stock item',
      label: lot.label,
      state: operatorLot?.approved ? 'exists' : 'new',
      href: records,
    },
    {
      kind: 'Location',
      label: located ? location.value : 'Not set',
      state: draft ? 'new' : located ? 'exists' : 'choose',
      href: records,
    },
  ]
}

function partValue(batch: CaptureSnapshotDto, part: Part | undefined) {
  if (!part) {
    return 'No Part proposal'
  }
  if (part.choice.mode === 'create') {
    return `Create shared Part: ${part.choice.spec.name}`
  }
  if (part.choice.mode !== 'set') {
    return `${part.label} · no existing Part chosen`
  }
  const choice = part.choice.value
  const observed = batch.observations.find((value) => value.id === choice.observation_id)
  return `${observed?.label ?? 'Observed Part'} (#${choice.pk})`
}

function legacyIssues(workspace: ManualWorkspaceDto, lot: Lot) {
  return workspace.lots.find((value) => value.lot_id === lot.id)?.issues ?? []
}

/** Chosen facts with provenance, shared scope and the commands that change them. */
export function DecisionPanel({
  batch,
  lot,
  part,
  workspace,
  operatorLot,
  media,
  activeLotIds,
  operator,
  disabled,
  edit,
  reload,
  inspect,
  markReviewed,
  openQuestion = null,
  answerQuestion,
  editPart,
  subjectsDisabled = false,
  openEvidence,
  editSignal = 0,
  onDirtyChange,
  agent = null,
}: Props) {
  const drafts = useDirtySources(onDirtyChange)
  const [comparing, setComparing] = useState(false)
  const [editing, setEditing] = useState(false)
  const [excluding, setExcluding] = useState(false)
  // The question being answered is pinned, so a later read cannot drop the draft or its retry.
  const [answering, setAnswering] = useState<OpenQuestion | null>(null)
  const [restructure, setRestructure] = useState<RestructureKind | null>(null)
  const sharing = batch.lots.filter(
    (other) =>
      other.id !== lot.id &&
      part !== undefined &&
      other.part_subject_id === part.id &&
      activeLotIds.includes(other.id),
  )
  useEffect(() => {
    if (!editSignal) {
      return
    }
    setEditing(true)
    const frame = requestAnimationFrame(() =>
      document.getElementById(QUICK_QUANTITY_INPUT_ID)?.focus(),
    )
    return () => cancelAnimationFrame(frame)
  }, [editSignal])

  const restructureLocked = disabled || drafts.dirty || !operator || Boolean(operatorLot?.approved)
  const reviewBlock = reviewBlockReason(operatorLot)
  const location = lotLocationFact(batch, lot, media)
  return (
    <>
      <Heading>{lot.label}</Heading>
      <RecordChain links={recordLinks(batch, lot, part, operatorLot, location)} />
      <AgentLine batchId={batch.id} status={agent} />
      {openQuestion && (
        <Paragraph>
          Processing has an open question about this lot.{' '}
          {answerQuestion && !answering && (
            <>
              <Button size="sm" onClick={() => setAnswering(openQuestion)}>
                Answer here
              </Button>{' '}
            </>
          )}
          <Link
            href={batchHref(batch.id, {
              tab: 'processing',
              step: openQuestion.step,
              questionId: openQuestion.id,
            })}
          >
            Answer the open question
          </Link>
        </Paragraph>
      )}
      {answerQuestion && answering && (
        <>
          <QuestionAnswer
            key={answering.id}
            question={answering.question}
            captureRevision={answering.captureRevision}
            currentQuestion={openQuestion?.id === answering.id ? openQuestion.question : undefined}
            currentCaptureRevision={openQuestion?.captureRevision ?? answering.captureRevision}
            disabled={disabled || drafts.hasOtherSources('answer')}
            answer={async (questionId, input, key) => {
              await answerQuestion(questionId, input, key)
              drafts.forSource('answer')(false)
              setAnswering(null)
            }}
            onDirtyChange={drafts.forSource('answer')}
          />
          {!drafts.isDirty('answer') && (
            <Button size="sm" variant="ghost" onClick={() => setAnswering(null)}>
              Close the answer
            </Button>
          )}
        </>
      )}
      <KeyValue
        rows={[
          {
            label: part?.choice.mode === 'create' ? 'New shared Part' : 'Existing Part',
            value: partValue(batch, part),
            state: 'plain',
            source: valueSource(part ? partProvenance(part.choice) : 'unset', false, openEvidence),
          },
          ...partFactRows(partFacts(batch, part), part),
          {
            label: 'Quantity',
            value: display(lot.quantity, batch, 'quantity'),
            state: 'plain',
            source: valueSource(lotProvenance(lot.quantity, batch.defaults.quantity), false),
          },
          ...(lot.estimated_quantity
            ? [
                {
                  label: 'Examine estimate',
                  value: `${lot.estimated_quantity}${lot.quantity_basis ? ` · ${lot.quantity_basis}` : ''}`,
                  state: 'plain' as const,
                  source: valueSource('unset', true, openEvidence),
                },
              ]
            : []),
          {
            label: 'Location',
            value: location.value,
            state: 'plain',
            source: valueSource(location.provenance, false, openEvidence),
          },
        ]}
      />
      <PartExtras aria-label="Shared Part proposal">
        <Small>{part?.label ?? 'No shared proposal'} · shared prerequisite only</Small>
        {sharing.length > 0 && (
          <SharedLine aria-label="Lots sharing this Part proposal">
            Shared with {sharing.length} other lot{sharing.length === 1 ? '' : 's'}:{' '}
            {sharing.map((other, index) => (
              <span key={other.id}>
                {index > 0 && ', '}
                <Button variant="link" type="button" onClick={() => inspect(other.id)}>
                  {other.label}
                </Button>
              </span>
            ))}
          </SharedLine>
        )}
        {part && (
          <SharedTagsChoice
            batch={batch}
            part={part}
            disabled={disabled || drafts.dirty}
            edit={edit}
          />
        )}
        {part && part.choice.mode !== 'create' && (
          <span>
            <Button
              size="sm"
              disabled={disabled || drafts.dirty}
              onClick={() => setComparing(true)}
            >
              Compare matches
            </Button>
          </span>
        )}
      </PartExtras>
      {operatorLot ? (
        <IssuePanel
          batch={batch}
          issues={operatorLot.issues}
          partLotLabels={[lot.id, ...operatorLot.shared_lot_ids].map(
            (id) => batch.lots.find((value) => value.id === id)?.label ?? id,
          )}
          client={operator}
          actionsFor={(issue) =>
            problemActions(issue, {
              batchId: batch.id,
              lotId: lot.id,
              partId: part?.id ?? null,
              openQuestion,
            })
          }
          onEditValues={() => setEditing(true)}
          onEditPart={editPart && part ? () => editPart(part.id) : undefined}
          // Any save remounts Review, so each draft waits for the others.
          disabled={disabled || drafts.hasOtherSources('warning')}
          reload={reload}
          onDirtyChange={drafts.forSource('warning')}
        />
      ) : (
        legacyIssues(workspace, lot).map((problem, index) => (
          <Banner tone="warn" key={`${problem.code}:${index}`}>
            {problem.message}
            {problem.run_id && (
              <>
                <br />
                <Link
                  href={batchHref(batch.id, {
                    tab: 'changes',
                    view: 'added',
                    runId: problem.run_id,
                  })}
                >
                  Inspect original run
                </Link>
              </>
            )}
          </Banner>
        ))
      )}
      <Actions aria-label="Edit this lot">
        <Button
          size="sm"
          disabled={disabled || (editing ? drafts.isDirty('quick') : drafts.dirty)}
          aria-expanded={editing}
          onClick={() => setEditing(!editing)}
        >
          {editing ? 'Close lot editor' : 'Edit lot values'}
        </Button>
        {editPart && (
          <Button size="sm" disabled={subjectsDisabled} onClick={() => editPart(lot.id)}>
            Edit lot details
          </Button>
        )}
        {editPart && part && (
          <Button size="sm" disabled={subjectsDisabled} onClick={() => editPart(part.id)}>
            Edit shared Part
          </Button>
        )}
        {operator && (
          <>
            <Button size="sm" disabled={restructureLocked} onClick={() => setRestructure('split')}>
              Split lot…
            </Button>
            <Button size="sm" disabled={restructureLocked} onClick={() => setRestructure('move')}>
              Move to Part proposal…
            </Button>
          </>
        )}
      </Actions>
      {operatorLot?.approved && (
        <Small>Approved lots keep their original identity and cannot be restructured.</Small>
      )}
      {editing && (
        <QuickLotEdit
          batch={batch}
          lot={lot}
          disabled={disabled || drafts.hasOtherSources('quick')}
          edit={edit}
          onDirtyChange={drafts.forSource('quick')}
        />
      )}
      {comparing && part && (
        <CompareMatches
          batch={batch}
          part={part}
          affectedLotIds={[lot.id, ...sharing.map((other) => other.id)]}
          disabled={disabled || drafts.hasOtherSources('compare')}
          edit={edit}
          onClose={() => setComparing(false)}
          onDirtyChange={drafts.forSource('compare')}
          onEditPart={editPart && (() => editPart(part.id))}
        />
      )}
      {excluding && !lot.excluded && (
        <ExcludeForm
          lot={lot}
          disabled={disabled || drafts.hasOtherSources('exclude')}
          edit={edit}
          onDone={() => setExcluding(false)}
          onDirtyChange={drafts.forSource('exclude')}
        />
      )}
      {markReviewed && operatorLot ? (
        <StickyFooter
          label="Lot actions"
          leading={
            lot.excluded ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled || drafts.dirty}
                onClick={() => void edit({ kind: 'lot_exclusion', lot_id: lot.id, reason: null })}
              >
                Include again
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                aria-expanded={excluding}
                disabled={disabled || (drafts.dirty && !excluding)}
                onClick={() => setExcluding(!excluding)}
              >
                Exclude…
              </Button>
            )
          }
          summary={
            <>
              {lot.excluded && <Small>Excluded: {lot.excluded.reason}</Small>}
              <Small>{reviewBlock ?? reviewSentence(operatorLot, workspace, lot)}</Small>
            </>
          }
          primary={
            <Button
              variant="primary"
              aria-keyshortcuts="R"
              disabled={disabled || drafts.dirty || reviewBlock !== null}
              onClick={markReviewed}
            >
              Mark reviewed <ButtonKbd aria-hidden="true">R</ButtonKbd>
            </Button>
          }
        />
      ) : (
        <Paragraph>{reviewSentence(operatorLot, workspace, lot)}</Paragraph>
      )}
      {restructure && operator && (
        <RestructureDialog
          kind={restructure}
          batch={batch}
          lotIds={[lot.id]}
          excludedLotIds={activeLotIds.filter((id) => id !== lot.id)}
          client={operator}
          disabled={disabled}
          reload={reload}
          onClose={() => setRestructure(null)}
          onDirtyChange={drafts.forSource('restructure')}
        />
      )}
    </>
  )
}

/**
 * Who a value came from: the operator's own choice, Examine's estimate (which opens the evidence),
 * or, for an inherited, missing or uncertain value, its provenance in words.
 */
function valueSource(provenance: Provenance, proposed: boolean, openEvidence?: () => void) {
  if (proposed) {
    return <SourceChip source="Examine" certainty="Estimated" tone="likely" onOpen={openEvidence} />
  }
  if (provenance === 'human' || provenance === 'override') {
    return <SourceChip source="You" certainty="Your edit" tone="user" />
  }
  return <ProvenancePill provenance={provenance} />
}

/** The new Part's maker and markings; supplier prices stay out (review-records). */
function partFactRows(facts: PartFacts, part: Part | undefined): KeyValueRow[] {
  const source = part ? valueSource(partProvenance(part.choice), false) : undefined
  const rows: [string, string | undefined, boolean][] = [
    ['Manufacturer', facts.manufacturer, false],
    ['MPN', facts.mpn, true],
    ['Package', facts.package, false],
    ['Date code', facts.dateCode, true],
  ]
  return rows.flatMap(([label, value, mono]) =>
    value ? [{ label, value, mono, state: 'plain' as const, source }] : [],
  )
}

function reviewSentence(
  operatorLot: OperatorLotDto | undefined,
  workspace: ManualWorkspaceDto,
  lot: Lot,
) {
  if (operatorLot?.review_state === 'changed_after_review') {
    return 'Changed after review: the reviewed facts no longer match. Review again.'
  }
  const reviewed =
    operatorLot?.review_state === 'reviewed' ||
    workspace.lots.find((value) => value.lot_id === lot.id)?.reviewed
  if (reviewed) {
    return 'Reviewed exact current dependencies.'
  }
  return 'Review binds these saved choices, relevant human notes and any warning dismissals.'
}

/** The shortcut drawn in the button's own ink, on any variant or state. */
const ButtonKbd = styled(Kbd)`
  border-color: currentColor;
  background: transparent;
  color: inherit;
`
const PartExtras = styled.div`
  display: grid;
  justify-items: start;
  gap: ${space[3]};
  margin: ${space[4]} 0;
  padding-bottom: ${space[5]};
  border-bottom: 1px solid ${color.line};
`
const SharedLine = styled.p`
  margin: 0;
  font-size: ${typeVar.body.size};
`
const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[4]};
  margin: ${space[4]} 0;
`
