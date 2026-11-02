import { useEffect, useState } from 'react'
import styled from 'styled-components'
import type {
  CaptureEditDto,
  CaptureSnapshotDto,
  ManualWorkspaceDto,
  OperatorLotDto,
} from '@invimport/contracts'
import { useDirtySources } from '../../operator/useDirtySources'
import { display } from '../../capture/display'
import { lotProvenance, partProvenance } from '../../operator/review-model'
import type { OperatorReviewClient } from '../../operator/types'
import { Button, Heading, Link, Notice, Paragraph, Small } from '../ui/primitives'
import { CompareMatches } from './CompareMatches'
import { FactRow } from './FactRow'
import { IssuePanel } from './IssuePanel'
import { QUICK_QUANTITY_INPUT_ID, QuickLotEdit } from './QuickLotEdit'
import { RestructureDialog, type RestructureKind } from './RestructureDialog'

type Lot = CaptureSnapshotDto['lots'][number]
type Part = CaptureSnapshotDto['parts'][number]

interface Props {
  batch: CaptureSnapshotDto
  lot: Lot
  part: Part | undefined
  workspace: ManualWorkspaceDto
  operatorLot?: OperatorLotDto
  /** Active lot IDs, used for shared-Part counts and impact previews. */
  activeLotIds: string[]
  operator?: OperatorReviewClient
  disabled: boolean
  edit: (change: CaptureEditDto['change']) => Promise<void>
  reload: () => Promise<void>
  inspect: (lotId: string) => void
  /** Increments when the operator asks to edit quantity (E). */
  editSignal?: number
  onDirtyChange?: (dirty: boolean) => void
}

function partValue(batch: CaptureSnapshotDto, part: Part | undefined) {
  if (!part) {
    return 'No Part proposal'
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
  activeLotIds,
  operator,
  disabled,
  edit,
  reload,
  inspect,
  editSignal = 0,
  onDirtyChange,
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
  return (
    <>
      <Heading>{lot.label}</Heading>
      <dl>
        <FactRow
          label="Existing Part"
          value={partValue(batch, part)}
          provenance={part ? partProvenance(part.choice) : 'unset'}
        >
          <Small>{part?.label ?? 'No shared proposal'} · shared prerequisite only</Small>
          {sharing.length > 0 && (
            <SharedLine aria-label="Lots sharing this Part proposal">
              Shared with {sharing.length} other lot{sharing.length === 1 ? '' : 's'}:{' '}
              {sharing.map((other, index) => (
                <span key={other.id}>
                  {index > 0 && ', '}
                  <LinkButton type="button" onClick={() => inspect(other.id)}>
                    {other.label}
                  </LinkButton>
                </span>
              ))}
            </SharedLine>
          )}
          {part && (
            <span>
              <Button disabled={disabled || drafts.dirty} onClick={() => setComparing(true)}>
                Compare matches
              </Button>
            </span>
          )}
        </FactRow>
        <FactRow
          label="Quantity"
          value={display(lot.quantity, batch, 'quantity')}
          provenance={lotProvenance(lot.quantity, batch.defaults.quantity)}
        />
        <FactRow
          label="Location"
          value={display(lot.location, batch, 'location')}
          provenance={lotProvenance(lot.location, batch.defaults.location)}
        />
      </dl>
      {operatorLot ? (
        <IssuePanel
          batch={batch}
          issues={operatorLot.issues}
          partLotLabels={[lot.id, ...operatorLot.shared_lot_ids].map(
            (id) => batch.lots.find((value) => value.id === id)?.label ?? id,
          )}
          client={operator}
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
                <Link href={`#${batch.id}/results/${problem.run_id}`}>Inspect original run</Link>
              </>
            )}
          </Notice>
        ))
      )}
      <Paragraph>{reviewSentence(operatorLot, workspace, lot)}</Paragraph>
      <Actions>
        <Button
          disabled={disabled || (editing ? drafts.isDirty('quick') : drafts.dirty)}
          aria-expanded={editing}
          onClick={() => setEditing(!editing)}
        >
          {editing ? 'Close lot editor' : 'Edit lot values'}
        </Button>
        {operator && (
          <>
            <Button disabled={restructureLocked} onClick={() => setRestructure('split')}>
              Split lot…
            </Button>
            <Button disabled={restructureLocked} onClick={() => setRestructure('move')}>
              Move to Part proposal…
            </Button>
          </>
        )}
        <Link href={`#${batch.id}/${lot.id}`}>Edit in Capture</Link>
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
        />
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

const SharedLine = styled.p`
  margin: 0;
  font-size: 14px;
`
const LinkButton = styled.button`
  padding: 0;
  border: 0;
  background: none;
  color: #164a93;
  text-decoration: underline;
  cursor: pointer;
  font: inherit;
`
const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
`
