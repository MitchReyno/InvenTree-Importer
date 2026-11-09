import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { validate, type MediaEditDto, type MediaSnapshotDto } from '@invimport/contracts'
import { serverQueryKey, useServerScope } from '#/queries/scope'
import { useRetainedPollInterval } from '#/components/operations/LiveUpdates'
import { useDirtySources } from '#/operator/useDirtySources'
import { useRetainedCommand } from '#/operator/useRetainedCommand'
import type { MediaClient } from './types'

export function useEvidenceWorkspace(
  batchId: string,
  client: MediaClient,
  disabled: boolean,
  onDirtyChange: (dirty: boolean) => void,
) {
  const scope = useServerScope()
  const cache = useQueryClient()
  const key = serverQueryKey(scope, 'media', batchId)
  const pollInterval = useRetainedPollInterval()
  const query = useQuery({
    queryKey: key,
    queryFn: () => client.snapshot(batchId),
    refetchInterval: pollInterval,
  })
  const drafts = useDirtySources(onDirtyChange)
  const accepted = useRef<MediaSnapshotDto | undefined>(undefined)
  const [snapshot, setSnapshot] = useState<MediaSnapshotDto>()
  // The editor waiting on the retained request, closed once it is confirmed.
  const onRetainedConfirmed = useRef<(() => void) | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const selectionRevision = useRef<string | null>(null)
  const command = useRetainedCommand((input: MediaEditDto, requestKey: string) =>
    client.edit(batchId, input, requestKey),
  )
  const unavailable = query.isError || query.fetchStatus === 'paused' || !query.isFetchedAfterMount

  useEffect(() => {
    const behindReceipt =
      accepted.current &&
      query.data &&
      BigInt(query.data.revision) < BigInt(accepted.current.revision)
    if (!unavailable && query.data && !behindReceipt && !drafts.hasOtherSources('crop')) {
      accepted.current = query.data
      setSnapshot(query.data)
    }
  }, [query.data, unavailable, drafts.dirty, drafts.hasOtherSources])

  function accept(value: MediaSnapshotDto) {
    accepted.current = value
    setSnapshot(value)
    cache.setQueryData(key, value)
  }

  async function fresh() {
    const result = await query.refetch({ throwOnError: true })
    if (!result.data) {
      throw new Error('media_snapshot_missing')
    }
    return result.data
  }

  async function confirmed(value: MediaSnapshotDto | null) {
    drafts.forSource('command')(command.hasPendingIntent())
    if (!value) {
      return false
    }
    accept(value)
    const close = onRetainedConfirmed.current
    onRetainedConfirmed.current = null
    close?.()
    try {
      await fresh()
    } catch {
      setError(
        'Change saved. The subsequent read failed; the saved receipt is retained. Refresh saved evidence to recover.',
      )
    }
    return true
  }

  /**
   * `readConfirmed` is for a caller that has just completed a fresh read in the same handler: its
   * render-time `unavailable` may still describe an earlier failed poll.
   */
  async function edit(
    change: MediaEditDto['change'],
    revision = snapshot?.revision,
    onConfirmed?: () => void,
    readConfirmed = false,
  ) {
    const readUnavailable = unavailable && !readConfirmed
    if (disabled || readUnavailable || command.busy || command.hasPendingIntent() || !revision) {
      return false
    }
    const input = { expected_revision: revision, change }
    try {
      validate('MediaEdit', input)
    } catch {
      setError('Check the evidence name, note or selection before saving.')
      return false
    }
    setError('')
    drafts.forSource('command')(true)
    onRetainedConfirmed.current = onConfirmed ?? null
    return confirmed(await command.submit(input))
  }

  function select(ids: string[], revision = snapshot?.revision) {
    if (!selected.length) {
      selectionRevision.current = revision ?? null
    }
    setSelected(ids)
    drafts.forSource('selection')(ids.length > 0)
    if (!ids.length) {
      selectionRevision.current = null
    }
  }

  async function move(
    ids: string[],
    groupId: string | null,
    revision = selectionRevision.current ?? snapshot?.revision,
    readConfirmed = false,
  ) {
    const current = accepted.current
    if (ids.length > 200) {
      setError('Select at most 200 evidence items for one atomic move.')
      return 'unconfirmed' as const
    }
    if (!current || !ids.length) {
      return 'unconfirmed' as const
    }
    if (ids.every((id) => current.evidence.find((item) => item.id === id)?.group_id === groupId)) {
      return 'unchanged' as const
    }
    select(ids, revision ?? undefined)
    const saved = await edit(
      { kind: 'move_many', evidence_ids: ids, group_id: groupId },
      revision ?? undefined,
      undefined,
      readConfirmed,
    )
    if (saved) {
      select([])
    }
    return saved ? ('saved' as const) : ('unconfirmed' as const)
  }

  async function reconcile() {
    if (command.hasPendingIntent()) {
      return
    }
    try {
      const value = await fresh()
      accept(value)
      const retained = selected.filter((id) => value.evidence.some((item) => item.id === id))
      setSelected(retained)
      selectionRevision.current = value.revision
      drafts.forSource('selection')(retained.length > 0)
      setError('')
    } catch {
      setError('Could not reload current membership. Selection and revision are preserved.')
    }
  }

  // Crop owns its exact recipe, derivation identifier and request key.
  async function saveCrop(input: MediaEditDto, requestKey: string) {
    if (disabled || unavailable) {
      throw new Error('current_media_read_required')
    }
    const value = await client.edit(batchId, input, requestKey)
    accept(value)
    try {
      await fresh()
    } catch {
      setError('Crop request saved. Refresh saved evidence to recover the read.')
    }
  }

  const refresh = useCallback(async () => {
    const value = await query.refetch({ throwOnError: true })
    if (!value.data) {
      throw new Error('media_snapshot_missing')
    }
    return value.data
  }, [query.refetch])

  return {
    snapshot,
    query,
    unavailable,
    drafts,
    error,
    setError,
    command,
    edit,
    selected,
    select,
    move,
    reconcile,
    saveCrop,
    refresh,
    accept,
    retry: async () => {
      const saved = await confirmed(await command.retry())
      if (saved) {
        select([])
      }
      return Boolean(saved)
    },
    discard: () => {
      if (!command.busy) {
        command.discard()
        onRetainedConfirmed.current = null
        drafts.forSource('command')(false)
      }
    },
  }
}
