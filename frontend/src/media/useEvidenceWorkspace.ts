import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { validate, type MediaEditDto, type MediaSnapshotDto } from '@invimport/contracts'
import { serverQueryKey } from '#/queries/scope'
import { useDirtySources } from '#/operator/useDirtySources'
import { useRetainedCommand } from '#/operator/useRetainedCommand'
import type { MediaClient } from './types'
import { useServerScope, useRetainedPollInterval } from '#/context'

/** `readConfirmed`: the caller has just completed a fresh read in the same handler. */
interface MediaCommandOptions {
  readConfirmed?: boolean
}

/**
 * What one media command did: confirmed, sent but unconfirmed (its intent is kept for an exact
 * retry), or not done (refused before sending, or definitely refused by the server).
 */
export type MediaCommandOutcome = 'saved' | 'unconfirmed' | 'not_sent'

type MediaChange = MediaEditDto['change']

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
  // The request behind the retained intent, so its exact retry can update the selection as the
  // first send would have.
  const retainedInput = useRef<MediaEditDto | null>(null)
  const command = useRetainedCommand((input: MediaEditDto, requestKey: string) =>
    client.edit(batchId, input, requestKey),
  )
  const unavailable = query.isError || query.fetchStatus === 'paused' || !query.isFetchedAfterMount
  // The sources live in a ref, so whether any draft is dirty is what reruns the adoption below.
  const { dirty: anyDraft, hasOtherSources } = drafts

  useEffect(() => {
    const behindReceipt =
      accepted.current &&
      query.data &&
      BigInt(query.data.revision) < BigInt(accepted.current.revision)
    if (!unavailable && query.data && !behindReceipt && !hasOtherSources('crop')) {
      accepted.current = query.data
      setSnapshot(query.data)
    }
  }, [query.data, unavailable, anyDraft, hasOtherSources])

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

  /**
   * A remove or restore leaves the membership the operator selected as it was, apart from the
   * files removed. When it was sent at the selection's own revision, the selection carries on at
   * the confirmed one; otherwise it keeps its revision, so it never takes in another change.
   */
  function rebaseSelection(input: MediaEditDto | null, revision: string) {
    const change = input?.change
    if (change?.kind !== 'remove' && change?.kind !== 'restore') {
      return
    }
    const removed = change.kind === 'remove' ? change.evidence_ids : []
    const kept = selected.filter((id) => !removed.includes(id))
    setSelected(kept)
    if (!kept.length) {
      selectionRevision.current = null
    } else if (input?.expected_revision === selectionRevision.current) {
      selectionRevision.current = revision
    }
    drafts.forSource('selection')(kept.length > 0)
  }

  async function confirmed(value: MediaSnapshotDto | null, input: MediaEditDto | null) {
    drafts.forSource('command')(command.hasPendingIntent())
    if (!command.hasPendingIntent()) {
      retainedInput.current = null
    }
    if (!value) {
      return false
    }
    accept(value)
    rebaseSelection(input, value.revision)
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
   * Sends one change. A confirmed read overrides render-time `unavailable`, which may describe an
   * earlier failed poll. Another change's retained intent refuses it before sending, so an
   * `unconfirmed` outcome is always this change's.
   */
  async function send(
    change: MediaChange,
    revision = snapshot?.revision,
    onConfirmed?: () => void,
    { readConfirmed = false }: MediaCommandOptions = {},
  ): Promise<MediaCommandOutcome> {
    const readUnavailable = unavailable && !readConfirmed
    if (disabled || readUnavailable || command.busy || command.hasPendingIntent() || !revision) {
      return 'not_sent'
    }
    const input = { expected_revision: revision, change }
    try {
      validate('MediaEdit', input)
    } catch {
      setError('Check the evidence name, note or selection before saving.')
      return 'not_sent'
    }
    setError('')
    drafts.forSource('command')(true)
    onRetainedConfirmed.current = onConfirmed ?? null
    retainedInput.current = input
    const saved = await confirmed(await command.submit(input), input)
    if (saved) {
      return 'saved'
    }
    return command.hasPendingIntent() ? 'unconfirmed' : 'not_sent'
  }

  async function edit(
    change: MediaChange,
    revision = snapshot?.revision,
    onConfirmed?: () => void,
    options: MediaCommandOptions = {},
  ) {
    return (await send(change, revision, onConfirmed, options)) === 'saved'
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
    options: MediaCommandOptions = {},
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
      options,
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

  const refetch = query.refetch

  const refresh = useCallback(async () => {
    const value = await refetch({ throwOnError: true })
    if (!value.data) {
      throw new Error('media_snapshot_missing')
    }
    return value.data
  }, [refetch])

  return {
    snapshot,
    query,
    unavailable,
    drafts,
    error,
    setError,
    command,
    edit,
    send,
    /** The last accepted snapshot, as a handler reads it after awaiting a command. */
    current: () => accepted.current,
    selected,
    select,
    move,
    reconcile,
    saveCrop,
    refresh,
    accept,
    retry: async () => {
      const input = retainedInput.current
      const change = input?.change
      const saved = await confirmed(await command.retry(), input)
      // A retried move confirms the selection it moved; a remove or restore rebased it above.
      if (saved && change?.kind !== 'remove' && change?.kind !== 'restore') {
        select([])
      }
      return Boolean(saved)
    },
    discard: () => {
      if (!command.busy) {
        command.discard()
        retainedInput.current = null
        onRetainedConfirmed.current = null
        drafts.forSource('command')(false)
      }
    },
  }
}
