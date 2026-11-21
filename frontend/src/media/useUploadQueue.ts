import { useLayoutEffect, useRef, useState } from 'react'
import { isMediaLabel, isMediaSourceSize, type MediaReceiptDto } from '@invimport/contracts'
import { classifyFailure } from '#/operator/command-failure'
import { useMountedRef } from '#/lifecycle/useMountedRef'

export type UploadKind = 'photos' | 'document'

/**
 * waiting and uploading show "Uploading…"; preparing reads the result and moves it into its group.
 * not_added and ungrouped are settled and only need dismissing; unconfirmed and unread are unsaved
 * work: an exact Retry, or a fresh read of a file the server already kept.
 */
export type UploadStatus =
  'waiting' | 'uploading' | 'preparing' | 'not_added' | 'unconfirmed' | 'unread' | 'ungrouped'

export interface UploadItem {
  /** Transient UI identity; file names are not unique. */
  id: string
  name: string
  groupId?: string
  /** The files picked together, which progress counts as one run. */
  pickId: string
  pickSize: number
  status: UploadStatus
  reason?: string
  /** The kept file's evidence, once the server has acknowledged it. */
  evidenceId?: string
}

interface UploadRequest {
  key: string
  revision: string
}

interface QueueEntry extends UploadItem {
  file: File
  /** The exact request last sent, kept for an identical Retry. */
  request?: UploadRequest
  receipt?: MediaReceiptDto
}

export interface UploadQueuePorts {
  /** Reads the batch's current media revision; each upload advances it. */
  currentRevision: () => Promise<string>
  upload: (file: File, key: string, revision: string) => Promise<MediaReceiptDto>
  /** Adopts a receipt and moves the file into its group; false when the move was not saved. */
  finish: (receipt: MediaReceiptDto, groupId?: string) => Promise<boolean>
  onDirtyChange: (dirty: boolean) => void
}

export interface UploadProgress {
  current: number
  total: number
}

export interface UploadQueue {
  /** Files still uploading or needing attention; a file in its group leaves the list. */
  items: UploadItem[]
  add: (files: File[], kind: UploadKind, groupId?: string) => void
  retry: (id: string) => void
  readAgain: (id: string) => void
  dismiss: (id: string) => void
  /** Drops "Added to Ungrouped" notices for files a read now shows in a group. */
  forgetPlaced: (evidence: { id: string; group_id: string | null }[]) => void
}

const ACCEPTED_TYPES: Record<UploadKind, string[]> = {
  photos: ['image/jpeg', 'image/png'],
  document: ['application/pdf'],
}
const ACTIVE: UploadStatus[] = ['waiting', 'uploading', 'preparing']
const UNSAVED: UploadStatus[] = [...ACTIVE, 'unconfirmed', 'unread']

/**
 * "Uploading 2 of 3" for the files shown in one group, counting every file picked with those still
 * in progress, including any already added, refused or dismissed. Null once none is in progress.
 */
export function uploadProgress(items: UploadItem[]): UploadProgress | null {
  const active = items.filter((item) => ACTIVE.includes(item.status))
  if (!active.length) {
    return null
  }
  const picks = new Map(active.map((item) => [item.pickId, item.pickSize]))
  const total = [...picks.values()].reduce((sum, size) => sum + size, 0)
  return { current: total - active.length + 1, total }
}

const REFUSAL_REASONS: Record<string, string> = {
  media_capacity: 'The batch has reached its 200-file limit. Deleted files count towards it too.',
  batch_archived: 'Resume this batch before adding evidence.',
  revision_conflict: 'Evidence kept changing while it uploaded. Pick the file again.',
  current_revision_unread: 'Current saved evidence could not be read, so the file was not sent.',
}

function refusalReason(code: string | null) {
  return (code && REFUSAL_REASONS[code]) ?? 'The server did not accept this file.'
}

/** The client's own upload rules, so a bad file is refused here rather than left unconfirmed. */
function invalidReason(file: File, kind: UploadKind) {
  if (!ACCEPTED_TYPES[kind].includes(file.type) || !file.size) {
    return 'Choose a nonempty JPEG or PNG photo, or a PDF document.'
  }
  if (!isMediaSourceSize(file.size)) {
    return 'Files can be up to 20 MiB.'
  }
  if (!isMediaLabel(file.name)) {
    return 'Rename the file: its name must be 1 to 256 characters without control characters.'
  }
  return null
}

function visibleItem(entry: QueueEntry): UploadItem {
  return {
    id: entry.id,
    name: entry.name,
    groupId: entry.groupId,
    pickId: entry.pickId,
    pickSize: entry.pickSize,
    status: entry.status,
    reason: entry.reason,
    evidenceId: entry.evidenceId,
  }
}

type SendOutcome =
  | { kind: 'retained'; receipt: MediaReceiptDto }
  | { kind: 'refused'; code: string | null }
  | { kind: 'unconfirmed'; request: UploadRequest }
  | { kind: 'stopped' }

/**
 * Uploads picked files one at a time, because each upload advances the batch's media revision.
 * Each file keeps its own idempotency key; a lost response keeps the exact request for Retry.
 * Unmounting stops new requests and follow-up reads; one already sent finishes on its own.
 */
export function useUploadQueue(ports: UploadQueuePorts): UploadQueue {
  const entries = useRef<QueueEntry[]>([])
  const [items, setItems] = useState<UploadItem[]>([])
  const running = useRef(false)
  const reportedDirty = useRef(false)
  const mounted = useMountedRef()
  // Handlers and the running queue read the latest ports; a layout Effect keeps render pure.
  const latest = useRef(ports)
  useLayoutEffect(() => {
    latest.current = ports
  })

  function publish() {
    // After unmount the guard has already been released; a late result must not set it again.
    if (!mounted.current) {
      return
    }
    setItems(entries.current.map(visibleItem))
    const dirty = entries.current.some((entry) => UNSAVED.includes(entry.status))
    if (dirty !== reportedDirty.current) {
      reportedDirty.current = dirty
      latest.current.onDirtyChange(dirty)
    }
  }

  function update(id: string, change: Partial<QueueEntry>) {
    entries.current = entries.current.map((entry) =>
      entry.id === id ? { ...entry, ...change } : entry,
    )
    publish()
  }

  function remove(id: string) {
    entries.current = entries.current.filter((entry) => entry.id !== id)
    publish()
  }

  async function sendOnce(file: File, request: UploadRequest): Promise<SendOutcome> {
    try {
      const receipt = await latest.current.upload(file, request.key, request.revision)
      return { kind: 'retained', receipt }
    } catch (error) {
      const failure = classifyFailure(error)
      if (failure.kind === 'uncertain') {
        return { kind: 'unconfirmed', request }
      }
      return {
        kind: 'refused',
        code: failure.kind === 'conflict' ? 'revision_conflict' : failure.code,
      }
    }
  }

  async function freshRequest(): Promise<UploadRequest | null> {
    try {
      const revision = await latest.current.currentRevision()
      return { key: crypto.randomUUID(), revision }
    } catch {
      return null
    }
  }

  /** A revision refusal proves the file was not kept, so it is sent once more at a fresh revision. */
  async function send(entry: QueueEntry): Promise<SendOutcome> {
    const first = entry.request ?? (await freshRequest())
    if (!first) {
      return { kind: 'refused', code: 'current_revision_unread' }
    }
    const outcome = await sendOnce(entry.file, first)
    if (outcome.kind !== 'refused' || outcome.code !== 'revision_conflict') {
      return outcome
    }
    if (!mounted.current) {
      return { kind: 'stopped' }
    }
    const second = await freshRequest()
    if (!mounted.current) {
      return { kind: 'stopped' }
    }
    if (!second) {
      return { kind: 'refused', code: 'current_revision_unread' }
    }
    return sendOnce(entry.file, second)
  }

  async function finishEntry(id: string, receipt: MediaReceiptDto, groupId?: string) {
    update(id, {
      status: 'preparing',
      receipt,
      evidenceId: receipt.evidence_id,
      request: undefined,
    })
    try {
      const grouped = await latest.current.finish(receipt, groupId)
      if (grouped) {
        remove(id)
      } else {
        update(id, { status: 'ungrouped' })
      }
    } catch {
      update(id, { status: 'unread' })
    }
  }

  async function process(entry: QueueEntry) {
    // A kept file whose read failed is read again in turn, never uploaded again.
    if (entry.receipt) {
      await finishEntry(entry.id, entry.receipt, entry.groupId)
      return
    }
    update(entry.id, { status: 'uploading', reason: undefined })
    const outcome = await send(entry)
    if (outcome.kind === 'stopped') {
      return
    }
    if (outcome.kind === 'unconfirmed') {
      update(entry.id, { status: 'unconfirmed', request: outcome.request })
      return
    }
    if (outcome.kind === 'refused') {
      update(entry.id, {
        status: 'not_added',
        request: undefined,
        reason: refusalReason(outcome.code),
      })
      return
    }
    if (!mounted.current) {
      return
    }
    await finishEntry(entry.id, outcome.receipt, entry.groupId)
  }

  async function drain() {
    if (running.current) {
      return
    }
    running.current = true
    try {
      let next = entries.current.find((entry) => entry.status === 'waiting')
      while (next && mounted.current) {
        await process(next)
        next = entries.current.find((entry) => entry.status === 'waiting')
      }
    } finally {
      running.current = false
    }
  }

  function add(files: File[], kind: UploadKind, groupId?: string) {
    const pickId = crypto.randomUUID()
    const added = files.map((file): QueueEntry => {
      const reason = invalidReason(file, kind)
      return {
        id: crypto.randomUUID(),
        name: file.name,
        groupId,
        pickId,
        pickSize: files.length,
        file,
        status: reason ? 'not_added' : 'waiting',
        reason: reason ?? undefined,
      }
    })
    if (!added.length) {
      return
    }
    entries.current = [...entries.current, ...added]
    publish()
    void drain()
  }

  function retry(id: string) {
    const entry = entries.current.find((item) => item.id === id)
    if (entry?.status !== 'unconfirmed') {
      return
    }
    update(id, { status: 'waiting' })
    void drain()
  }

  function readAgain(id: string) {
    const entry = entries.current.find((item) => item.id === id)
    if (entry?.status !== 'unread') {
      return
    }
    update(id, { status: 'waiting' })
    void drain()
  }

  function dismiss(id: string) {
    const entry = entries.current.find((item) => item.id === id)
    if (entry?.status !== 'not_added' && entry?.status !== 'ungrouped') {
      return
    }
    remove(id)
  }

  function forgetPlaced(evidence: { id: string; group_id: string | null }[]) {
    const grouped = new Set(
      evidence.filter((item) => item.group_id !== null).map((item) => item.id),
    )
    const placed = entries.current.filter(
      (entry) => entry.status === 'ungrouped' && entry.evidenceId && grouped.has(entry.evidenceId),
    )
    if (!placed.length) {
      return
    }
    entries.current = entries.current.filter((entry) => !placed.includes(entry))
    publish()
  }

  return { items, add, retry, readAgain, dismiss, forgetPlaced }
}
