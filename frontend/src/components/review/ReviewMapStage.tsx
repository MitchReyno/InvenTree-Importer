import { useEffect, useRef, useState } from 'react'
import { Banner } from '../ui/Banner'
import { Button } from '../ui/Button'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { CaptureEditDto, CaptureSnapshotDto } from '@invimport/contracts'
import type { MediaClient } from '../../media/types'
import type { OperatorReviewClient } from '../../operator/types'
import { serverQueryKey, useServerScope } from '../../queries/scope'
import { RestructureDialog } from '../operator/RestructureDialog'

import { ReviewMap } from './ReviewMap'
import { TellExamine } from './TellExamine'
import { useDirtySources } from '../../operator/useDirtySources'
import type { ProcessingClient } from '../../processing/types'

type Props = {
  batch: CaptureSnapshotDto
  media: MediaClient | undefined
  edit: (change: CaptureEditDto['change']) => Promise<boolean | void>
  operator?: OperatorReviewClient
  retiredLotIds: ReadonlySet<string>
  predecessors?: ReadonlyMap<string, readonly string[]>
  approvedLotIds?: ReadonlySet<string>
  /** True while the latest operator review is unread, so added lots may not be known yet. */
  restructureUnavailable?: boolean
  reload: () => Promise<void>
  onDirtyChange: (dirty: boolean) => void
  /** Counts discards of the batch's local edits; an unsaved region draft is dropped on each. */
  discarded?: number
  /** Present with agent sessions: the Map's instruction goes to the Examine lead session. */
  processing?: ProcessingClient
}

/** A lot made from a file (linked once it exists) or a region (moved into it once it exists). */
type PendingLot = {
  from: { kind: 'file'; evidenceId: string } | { kind: 'region'; observationId: string }
  label: string
  knownLotIds: string[]
}
type Unfinished = Pick<PendingLot, 'from' | 'label'> & { lotId: string; lotLabel: string }

/** Review › Map: reads the evidence and applies its direct edits through the existing commands. */
export function ReviewMapStage({
  batch,
  media,
  edit,
  operator,
  retiredLotIds,
  predecessors,
  approvedLotIds = NO_LOTS,
  restructureUnavailable = false,
  reload,
  onDirtyChange,
  discarded,
  processing,
}: Props) {
  const drafts = useDirtySources(onDirtyChange)
  const scope = useServerScope()
  const queryClient = useQueryClient()
  const key = serverQueryKey(scope, 'media', batch.id)
  const query = useQuery({
    queryKey: key,
    queryFn: () => media!.snapshot(batch.id),
    enabled: Boolean(media),
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [unfinished, setUnfinished] = useState<Unfinished | null>(null)
  const [restructure, setRestructure] = useState<{
    kind: 'split' | 'merge' | 'move'
    lotIds: string[]
  } | null>(null)
  // A new lot gets its id from the server, so its file is linked once the lot appears.
  const pending = useRef<PendingLot | null>(null)

  async function link(evidenceId: string, lotId: string, linked: boolean) {
    const snapshot = query.data
    if (!media || !snapshot) {
      return false
    }
    setBusy(true)
    setError('')
    try {
      const next = await media.edit(
        batch.id,
        {
          expected_revision: snapshot.revision,
          change: { kind: 'link', evidence_id: evidenceId, subject_id: lotId, linked },
        },
        crypto.randomUUID(),
      )
      queryClient.setQueryData(key, next)
      return true
    } catch {
      setError('The link could not be saved. Refresh and try again.')
      void query.refetch()
      return false
    } finally {
      setBusy(false)
    }
  }

  async function newLotFrom(evidenceId: string, label: string) {
    setBusy(true)
    setError('')
    pending.current = {
      from: { kind: 'file', evidenceId },
      label,
      knownLotIds: batch.lots.map((lot) => lot.id),
    }
    try {
      // The batch edit reports failure as false rather than throwing.
      const saved = await edit({
        kind: 'add_lot',
        label,
        note: `Made from evidence “${label}”.`,
        part_subject_id: null,
      })
      if (saved === false) {
        pending.current = null
      }
    } catch {
      pending.current = null
      setError('The lot could not be made. Refresh and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function markSameItem(observationId: string, sameAs: string | null) {
    setBusy(true)
    setError('')
    try {
      const saved = await edit({
        kind: 'observation_same_item',
        observation_id: observationId,
        same_as: sameAs,
      })
      if (saved === false) {
        setError('The region could not be marked. Refresh and try again.')
      }
    } catch {
      setError('The region could not be marked. Refresh and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function moveRegion(observationId: string, lotId: string | null) {
    setBusy(true)
    setError('')
    try {
      const saved = await edit({
        kind: 'observation_move',
        observation_id: observationId,
        lot_id: lotId,
      })
      if (saved === false) {
        setError('The region could not be moved. Refresh and try again.')
        return false
      }
      return true
    } catch {
      setError('The region could not be moved. Refresh and try again.')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function newLotFromRegion(observationId: string, label: string) {
    setBusy(true)
    setError('')
    pending.current = {
      from: { kind: 'region', observationId },
      label,
      knownLotIds: batch.lots.map((lot) => lot.id),
    }
    try {
      const saved = await edit({
        kind: 'add_lot',
        label,
        note: `Made from region “${label}”.`,
        part_subject_id: null,
      })
      if (saved === false) {
        pending.current = null
      }
    } catch {
      pending.current = null
      setError('The lot could not be made. Refresh and try again.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    const waiting = pending.current
    if (!waiting) {
      return
    }
    const created = batch.lots.find(
      (lot) => !waiting.knownLotIds.includes(lot.id) && lot.label === waiting.label,
    )
    if (created) {
      pending.current = null
      void finish({
        from: waiting.from,
        label: waiting.label,
        lotId: created.id,
        lotLabel: created.label,
      })
    }
  })

  // The new lot exists; its file link or region move is kept until confirmed so it can be finished.
  async function finish(step: Unfinished) {
    setUnfinished(step)
    const done =
      step.from.kind === 'file'
        ? await link(step.from.evidenceId, step.lotId, true)
        : await moveRegion(step.from.observationId, step.lotId)
    if (done) {
      setUnfinished(null)
    }
  }

  const disabled = busy || batch.archived || !media || !query.data

  const tellExamine = !batch.archived && (
    <TellExamine
      batchId={batch.id}
      processing={processing}
      onDirtyChange={drafts.forSource('tell-examine')}
    />
  )

  return (
    <>
      {error && (
        <div role="alert">
          <Banner tone="bad">{error}</Banner>
        </div>
      )}
      {unfinished && !busy && (
        <Banner
          tone="warn"
          action={
            <Button size="sm" onClick={() => void finish(unfinished)}>
              {unfinished.from.kind === 'file'
                ? `Link the file to lot ${unfinished.lotLabel}`
                : `Move ${unfinished.label} into lot ${unfinished.lotLabel}`}
            </Button>
          }
        >
          Lot {unfinished.lotLabel} was made, but{' '}
          {unfinished.from.kind === 'file' ? 'its file is not linked' : 'its region was not moved'}{' '}
          yet.
        </Banner>
      )}
      {!media ? (
        <div role="status">
          <Banner tone="bad">Evidence is not available in this setup.</Banner>
        </div>
      ) : (
        <ReviewMap
          batch={batch}
          evidence={query.data?.evidence}
          loading={query.isPending}
          approvedLotIds={approvedLotIds}
          restructureUnavailable={restructureUnavailable}
          retiredLotIds={retiredLotIds}
          predecessors={predecessors}
          disabled={disabled}
          link={link}
          newLotFrom={newLotFrom}
          moveRegion={moveRegion}
          newLotFromRegion={newLotFromRegion}
          markSameItem={markSameItem}
          editRegion={edit}
          onRegionDirtyChange={drafts.forSource('region')}
          selectionLocked={drafts.isDirty('region')}
          discarded={discarded}
          openRestructure={
            operator ? (kind, lotIds) => setRestructure({ kind, lotIds }) : undefined
          }
          aside={tellExamine}
        />
      )}
      {!media && tellExamine}
      {restructure && operator && (
        <RestructureDialog
          kind={restructure.kind}
          batch={batch}
          lotIds={restructure.lotIds}
          excludedLotIds={batch.lots
            .filter((lot) => !retiredLotIds.has(lot.id) && !restructure.lotIds.includes(lot.id))
            .map((lot) => lot.id)}
          client={operator}
          disabled={batch.archived}
          reload={reload}
          onClose={() => setRestructure(null)}
          onDirtyChange={drafts.forSource('restructure')}
        />
      )}
    </>
  )
}

const NO_LOTS: ReadonlySet<string> = new Set()
