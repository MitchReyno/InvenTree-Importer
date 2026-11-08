import { useState } from 'react'
import styled from 'styled-components'
import { space } from '../../theme/generated/tokens'
import type { CaptureSnapshotDto, OperatorReviewDto } from '@invimport/contracts'
import { useDirtySources } from '../../operator/useDirtySources'
import { blockingIssues, openWarnings } from '../../operator/review-model'
import type { OperatorReviewClient } from '../../operator/types'
import { BulkBar } from '../ui/BulkBar'
import { Button } from '../ui/Button'
import { BulkEditPanel } from './BulkEditPanel'
import { RestructureDialog } from './RestructureDialog'
import { ReviewTable, type ReviewTableProps } from './ReviewTable'

const MAX_MERGE_LOTS = 10

interface Props {
  batch: CaptureSnapshotDto
  review: OperatorReviewDto
  client: OperatorReviewClient
  media?: ReviewTableProps['media']
  lotIds: string[]
  activeLotIds: string[]
  disabled: boolean
  maxReviewLots: number
  /** The selection shared with the Workspace view. */
  selected: string[]
  setSelection: (ids: string[]) => void
  inspect: (lotId: string) => void
  reviewLots: (lotIds: string[]) => void
  reload: () => Promise<void>
  onDirtyChange?: (dirty: boolean) => void
}

function reviewBlocker(review: OperatorReviewDto, lotIds: string[], max: number) {
  if (lotIds.length > max) {
    return `Review at most ${max} lots at once.`
  }
  const lots = review.lots.filter((lot) => lotIds.includes(lot.lot_id))
  if (lots.some((lot) => blockingIssues(lot).length || openWarnings(lot).length)) {
    return 'Fix blocking problems and fix or dismiss warnings first.'
  }
  return null
}

/** The Table shares its selection and filter with the Workspace view. */
export function TableWorkspace({
  batch,
  review,
  client,
  media,
  lotIds,
  activeLotIds,
  disabled,
  maxReviewLots,
  selected: shared,
  setSelection,
  inspect,
  reviewLots,
  reload,
  onDirtyChange,
}: Props) {
  const drafts = useDirtySources(onDirtyChange)
  const selection: ReadonlySet<string> = new Set(shared)
  const [dialog, setDialog] = useState<'merge' | 'move' | null>(null)
  const selected = activeLotIds.filter((id) => selection.has(id))
  const approvedSelected = review.lots.some((lot) => lot.approved && selection.has(lot.lot_id))
  const blocker = reviewBlocker(review, selected, maxReviewLots)

  function toggle(lotId: string) {
    const next = new Set(selection)
    if (next.has(lotId)) {
      next.delete(lotId)
    } else {
      next.add(lotId)
    }
    setSelection([...next])
  }

  function toggleAll(ids: string[]) {
    const everySelected = ids.every((id) => selection.has(id))
    const next = new Set(selection)
    for (const id of ids) {
      if (everySelected) {
        next.delete(id)
      } else {
        next.add(id)
      }
    }
    setSelection([...next])
  }

  return (
    <>
      {selected.length > 0 && (
        <SelectionBar>
          <BulkBar
            label="Selected lots"
            count={selected.length}
            onClear={() => setSelection(shared.filter((id) => !activeLotIds.includes(id)))}
            extraActions={
              <>
                <Button
                  size="sm"
                  disabled={disabled || drafts.dirty || Boolean(blocker)}
                  onClick={() => reviewLots(selected)}
                >
                  Mark {selected.length} reviewed
                </Button>
                <Button
                  size="sm"
                  disabled={
                    disabled ||
                    drafts.dirty ||
                    selected.length < 2 ||
                    selected.length > MAX_MERGE_LOTS ||
                    approvedSelected
                  }
                  onClick={() => setDialog('merge')}
                >
                  Merge selected…
                </Button>
                <Button
                  size="sm"
                  disabled={disabled || drafts.dirty || approvedSelected}
                  onClick={() => setDialog('move')}
                >
                  Move selected to Part proposal…
                </Button>
                {blocker && <span role="status">{blocker}</span>}
                {approvedSelected && <span>Approved lots cannot be merged or moved.</span>}
              </>
            }
          />
        </SelectionBar>
      )}
      <ReviewTable
        batch={batch}
        review={review}
        media={media}
        lotIds={lotIds}
        selected={selection}
        disabled={disabled}
        toggle={toggle}
        toggleAll={toggleAll}
        inspect={inspect}
      />
      <BulkEditPanel
        batch={batch}
        selectedIds={selected}
        activeLotIds={activeLotIds}
        client={client}
        disabled={disabled || drafts.isDirty('restructure')}
        reload={reload}
        onDirtyChange={drafts.forSource('bulk')}
      />
      {dialog && (
        <RestructureDialog
          kind={dialog}
          batch={batch}
          lotIds={selected}
          excludedLotIds={activeLotIds.filter((id) => !selection.has(id))}
          client={client}
          disabled={disabled}
          reload={reload}
          onClose={() => setDialog(null)}
          onDirtyChange={drafts.forSource('restructure')}
        />
      )}
    </>
  )
}

const SelectionBar = styled.div`
  margin-bottom: ${space[4]};
`
