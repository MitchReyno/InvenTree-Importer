import { useEffect, useState } from 'react'
import styled from 'styled-components'
import { color, space, typeVar } from '../../theme/generated/tokens'
import type {
  CaptureEditDto,
  CaptureSnapshotDto,
  ManualWorkspaceDto,
  MediaSnapshotDto,
  OperatorLotDto,
} from '@invimport/contracts'
import { useDirtySources } from '../../operator/useDirtySources'
import { display } from '../../capture/display'
import { lotLocationFact, lotProvenance, partProvenance } from '../../operator/review-model'
import type { OperatorReviewClient } from '../../operator/types'
import { Heading, Link, Notice, Paragraph, Small } from '../ui/primitives'
import { Button } from '../ui/Button'
import { Kbd } from '../ui/Kbd'
import { StickyFooter } from '../ui/StickyFooter'
import { CompareMatches } from './CompareMatches'
import { KeyValue } from '../ui/KeyValue'
import { ProvenancePill } from './ProvenancePill'
import { partFacts, type PartFacts } from '../../operator/part-facts'
import type { KeyValueRow } from '../ui/KeyValue'
import { SharedTagsChoice } from './SharedTagsChoice'
import { IssuePanel } from './IssuePanel'
import { QUICK_QUANTITY_INPUT_ID, QuickLotEdit } from './QuickLotEdit'
import { RestructureDialog, type RestructureKind } from './RestructureDialog'
import { batchHref, type ProcessingStep } from '../../navigation/batch-route'
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
  openQuestion?: { id: string; step: ProcessingStep } | null
  /** Marks this one lot reviewed; refused while it has unresolved problems. */
  markReviewed?: () => void
  /** Opens Review's shared Part editor for this Part. */
  /** Opens the subject editor for a lot or Part; also the lot's "Edit lot details". */
  editPart?: (partId: string) => void
  /** Locks the subject editor entry points (no observe client, archived or unsaved work). */
  subjectsDisabled?: boolean
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
  editPart,
  subjectsDisabled = false,
  editSignal = 0,
  onDirtyChange,
  agent = null,
}: Props) {
  const drafts = useDirtySources(onDirtyChange)
  const [comparing, setComparing] = useState(false)
  const [editing, setEditing] = useState(false)
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
      <KeyValue
        rows={[
          {
            label: part?.choice.mode === 'create' ? 'New shared Part' : 'Existing Part',
            value: partValue(batch, part),
            state: 'plain',
            source: <ProvenancePill provenance={part ? partProvenance(part.choice) : 'unset'} />,
          },
          ...partFactRows(partFacts(batch, part), part),
          {
            label: 'Quantity',
            value: display(lot.quantity, batch, 'quantity'),
            state: 'plain',
            source: (
              <ProvenancePill provenance={lotProvenance(lot.quantity, batch.defaults.quantity)} />
            ),
          },
          {
            label: 'Location',
            value: location.value,
            state: 'plain',
            source: <ProvenancePill provenance={location.provenance} />,
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
          disabled={
            disabled ||
            drafts.isDirty('quick') ||
            drafts.isDirty('restructure') ||
            drafts.isDirty('compare')
          }
          reload={reload}
          onDirtyChange={drafts.forSource('warning')}
        />
      ) : (
        legacyIssues(workspace, lot).map((problem, index) => (
          <Notice key={`${problem.code}:${index}`}>
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
          </Notice>
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
          disabled={
            disabled ||
            drafts.isDirty('warning') ||
            drafts.isDirty('restructure') ||
            drafts.isDirty('compare')
          }
          edit={edit}
          onDirtyChange={drafts.forSource('quick')}
        />
      )}
      {comparing && part && (
        <CompareMatches
          batch={batch}
          part={part}
          affectedLotIds={[lot.id, ...sharing.map((other) => other.id)]}
          disabled={disabled}
          edit={edit}
          onClose={() => setComparing(false)}
          onDirtyChange={drafts.forSource('compare')}
          onEditPart={editPart && (() => editPart(part.id))}
        />
      )}
      {markReviewed && operatorLot ? (
        <StickyFooter
          label="Lot actions"
          leading={
            <Button size="sm" variant="ghost" disabled>
              Exclude
            </Button>
          }
          summary={
            <>
              <Small>{reviewBlock ?? reviewSentence(operatorLot, workspace, lot)}</Small>
              <Small>Excluding a lot arrives with record edits.</Small>
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

/** The new Part's maker and markings; supplier prices stay out (review-records). */
function partFactRows(facts: PartFacts, part: Part | undefined): KeyValueRow[] {
  const source = part ? <ProvenancePill provenance={partProvenance(part.choice)} /> : undefined
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
