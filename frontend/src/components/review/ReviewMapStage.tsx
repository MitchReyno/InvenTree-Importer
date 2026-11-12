import { useState } from 'react'
import { Banner, Button } from '#/components/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { CaptureSnapshotDto, MediaSnapshotDto } from '@invimport/contracts'
import { serverQueryKey } from '#/queries/scope'
import { RestructureDialog } from '#/components/operator/RestructureDialog'

import { ReviewMap } from './ReviewMap'
import { TellExamine } from './TellExamine'
import { useDirtySources } from '#/operator/useDirtySources'
import { useApiClients, useServerScope, useBatchCommands } from '#/context'

type Props = {
  batch: CaptureSnapshotDto
  retiredLotIds: ReadonlySet<string>
  predecessors?: ReadonlyMap<string, readonly string[]>
  approvedLotIds?: ReadonlySet<string>
  /** True while the latest operator review is unread, so added lots may not be known yet. */
  restructureUnavailable?: boolean
  onDirtyChange: (dirty: boolean) => void
  /** Counts discards of the batch's local edits; an unsaved region draft is dropped on each. */
  discarded?: number
}

/** A lot made from a file (then linked to it) or a region (then moved into it). */
type LotSource = { kind: 'file'; evidenceId: string } | { kind: 'region'; observationId: string }
type Unfinished = { from: LotSource; label: string; lotId: string; lotLabel: string }

/** Review › Map: reads the evidence and applies its direct edits through the existing commands. */
export function ReviewMapStage({
  batch,
  retiredLotIds,
  predecessors,
  approvedLotIds = NO_LOTS,
  restructureUnavailable = false,
  onDirtyChange,
  discarded,
}: Props) {
  const { edit, reload } = useBatchCommands()
  const { media, operator } = useApiClients()
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

  async function link(evidenceId: string, lotId: string, linked: boolean) {
    // Read at send time: a handler may run after its closure's media read was replaced.
    const snapshot = queryClient.getQueryData<MediaSnapshotDto>(key) ?? query.data
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

  /** Makes a lot, then links its file or moves its region into it once the save is confirmed. */
  async function newLot(from: LotSource, label: string, note: string) {
    const knownLotIds = batch.lots.map((lot) => lot.id)
    setBusy(true)
    setError('')
    try {
      // The batch edit reports failure as false rather than throwing.
      const saved = await edit({ kind: 'add_lot', label, note, part_subject_id: null })
      if (saved === false) {
        return
      }
      // The server assigns the new lot's id, so it is found in the accepted snapshot.
      const accepted = typeof saved === 'object' ? saved : undefined
      const created = accepted?.lots.find(
        (lot) => !knownLotIds.includes(lot.id) && lot.label === label,
      )
      if (!accepted || !created) {
        setError(
          from.kind === 'file'
            ? 'The lot was made, but its file was not linked. Link it from the Map.'
            : 'The lot was made, but its region was not moved. Move it from the Map.',
        )
        return
      }
      // This closure's batch predates the new lot, so the move names the accepted revision.
      await finish({ from, label, lotId: created.id, lotLabel: created.label }, accepted.revision)
    } catch {
      setError('The lot could not be made. Refresh and try again.')
    } finally {
      setBusy(false)
    }
  }

  function newLotFrom(evidenceId: string, label: string) {
    return newLot({ kind: 'file', evidenceId }, label, `Made from evidence “${label}”.`)
  }

  function newLotFromRegion(observationId: string, label: string) {
    return newLot({ kind: 'region', observationId }, label, `Made from region “${label}”.`)
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

  async function moveRegion(observationId: string, lotId: string | null, revision?: string) {
    setBusy(true)
    setError('')
    try {
      const change = {
        kind: 'observation_move' as const,
        observation_id: observationId,
        lot_id: lotId,
      }
      const saved = await edit(change, revision)
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

  // The new lot exists; its file link or region move is kept until confirmed so it can be finished.
  async function finish(step: Unfinished, revision?: string) {
    setUnfinished(step)
    const done =
      step.from.kind === 'file'
        ? await link(step.from.evidenceId, step.lotId, true)
        : await moveRegion(step.from.observationId, step.lotId, revision)
    if (done) {
      setUnfinished(null)
    }
  }

  const disabled = busy || batch.archived || !media || !query.data

  const tellExamine = !batch.archived && (
    <TellExamine batchId={batch.id} onDirtyChange={drafts.forSource('tell-examine')} />
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
