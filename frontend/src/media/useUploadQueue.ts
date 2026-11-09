import { useEffect, useRef, useState } from 'react'
import { MEDIA_SOURCE_MAX_BYTES, type MediaReceiptDto } from '@invimport/contracts'
import { classifyFailure } from '#/operator/command-failure'

export type UploadKind = 'photos' | 'document'

/**
 * waiting and uploading show "Uploading…"; preparing reads the result and moves it into its group.
 * not_added and ungrouped are settled and only need dismissing; unconfirmed and unread are unsaved
 * work: an exact Retry, or a fresh read of a file the server already kept.
 */
export type UploadStatus =
  | 'waiting'
  | 'uploading'
  | 'preparing'
  | 'done'
  | 'not_added'
  | 'unconfirmed'
  | 'unread'
  | 'ungrouped'

export interface UploadItem {
  /** Transient UI identity; file names are not unique. */
  id: string
  name: string
  groupId?: string
  status: UploadStatus
  reason?: string
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

/** "Uploading 2 of 3" for the files shown in one group; null once none is still in progress. */
export function uploadProgress(items: UploadItem[]): UploadProgress | null {
  const active = items.filter((item) => ACTIVE.includes(item.status))
  if (!active.length) {
    return null
  }
  const done = items.filter((item) => item.status === 'done').length
  return { current: done + 1, total: done + active.length }
}

export interface UploadQueue {
  items: UploadItem[]
  add: (files: File[], kind: UploadKind, groupId?: string) => void
  retry: (id: string) => void
  readAgain: (id: string) => void
  dismiss: (id: string) => void
}

const ACCEPTED_TYPES: Record<UploadKind, string[]> = {
  photos: ['image/jpeg', 'image/png'],
  document: ['application/pdf'],
}
const MAX_LABEL_CODE_POINTS = 256
const ACTIVE: UploadStatus[] = ['waiting', 'uploading', 'preparing']
const UNSAVED: UploadStatus[] = [...ACTIVE, 'unconfirmed', 'unread']

const REFUSAL_REASONS: Record<string, string> = {
  media_capacity: 'The batch has reached its evidence limit.',
  batch_archived: 'Resume this batch before adding evidence.',
  revision_conflict: 'Evidence kept changing while it uploaded. Pick the file again.',
  current_revision_unread: 'Current saved evidence could not be read, so the file was not sent.',
}

function refusalReason(code: string | null) {
  return (code && REFUSAL_REASONS[code]) ?? 'The server did not accept this file.'
}

/** Mirrors the server's label rule, so a bad name is refused here rather than left unconfirmed. */
function invalidReason(file: File, kind: UploadKind) {
  if (!ACCEPTED_TYPES[kind].includes(file.type) || !file.size) {
    return 'Choose a nonempty JPEG or PNG photo, or a PDF document.'
  }
  if (file.size > MEDIA_SOURCE_MAX_BYTES) {
    return 'Files can be up to 20 MiB.'
  }
  if (!acceptedLabel(file.name)) {
    return 'Rename the file: its name must be 1 to 256 characters without control characters.'
  }
  return null
}

function isControlCharacter(character: string) {
  const code = character.codePointAt(0) ?? 0
  return code <= 0x1f || code === 0x7f
}

function acceptedLabel(label: string) {
  const characters = [...label]
  if (!label.trim() || characters.length > MAX_LABEL_CODE_POINTS) {
    return false
  }
  return !characters.some(isControlCharacter)
}

type SendOutcome =
  | { kind: 'retained'; receipt: MediaReceiptDto }
  | { kind: 'refused'; code: string | null }
  | { kind: 'unconfirmed'; request: UploadRequest }

/**
 * Uploads picked files one at a time, because each upload advances the batch's media revision.
 * Each file keeps its own idempotency key; a lost response keeps the exact request for Retry.
 */
export function useUploadQueue(ports: UploadQueuePorts): UploadQueue {
  const entries = useRef<QueueEntry[]>([])
  const [items, setItems] = useState<UploadItem[]>([])
  const running = useRef(false)
  const reportedDirty = useRef(false)
  // Unmounting stops new uploads from starting; one already sent finishes on its own.
  const mounted = useRef(true)
  const latest = useRef(ports)
  latest.current = ports

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  function publish() {
    // Completed files leave once nothing is uploading; until then they count towards progress.
    if (!entries.current.some((entry) => ACTIVE.includes(entry.status))) {
      entries.current = entries.current.filter((entry) => entry.status !== 'done')
    }
    setItems(
      entries.current.map(({ id, name, groupId, status, reason }) => ({
        id,
        name,
        groupId,
        status,
        reason,
      })),
    )
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
    const second = await freshRequest()
    if (!second) {
      return { kind: 'refused', code: 'current_revision_unread' }
    }
    return sendOnce(entry.file, second)
  }

  async function finishEntry(id: string, receipt: MediaReceiptDto, groupId?: string) {
    update(id, { status: 'preparing', receipt, request: undefined })
    try {
      const grouped = await latest.current.finish(receipt, groupId)
      update(id, grouped ? { status: 'done' } : { status: 'ungrouped' })
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
    const added = files.map((file): QueueEntry => {
      const reason = invalidReason(file, kind)
      return {
        id: crypto.randomUUID(),
        name: file.name,
        groupId,
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
    entries.current = entries.current.filter((item) => item.id !== id)
    publish()
  }

  return { items, add, retry, readAgain, dismiss }
}
