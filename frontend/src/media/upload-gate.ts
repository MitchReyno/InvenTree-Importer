/** What decides whether a pick, a drop or a paste may start uploading. */
export interface UploadGateState {
  archived: boolean
  /** Capture as a whole is frozen: a batch command is being sent or another Capture draft is open. */
  disabled: boolean
  /** A read of the saved evidence has succeeded and is still current. */
  current: boolean
  /** An evidence change is being sent. */
  sending: boolean
  /** An evidence change was sent without confirmation and waits for Retry or Discard. */
  unconfirmed: boolean
  /** Another evidence draft, such as a new group name or a selection, is open. */
  otherDraftOpen: boolean
}

/** Why nothing can be added when Capture has no media storage at all. */
export const MEDIA_UNAVAILABLE_REASON = 'Media storage is unavailable.'

export type UploadRefusalKind = 'archived' | 'disabled' | 'stale' | 'pending' | 'draft'

export interface UploadRefusal {
  kind: UploadRefusalKind
  reason: string
}

/** Why files can't start uploading now, or null when they can. */
export function uploadRefusal(state: UploadGateState): UploadRefusal | null {
  if (state.archived) {
    return { kind: 'archived', reason: 'Resume the batch to add files.' }
  }
  if (state.disabled) {
    return {
      kind: 'disabled',
      reason: 'Adding files waits until other Capture changes are saved or discarded.',
    }
  }
  if (!state.current) {
    return { kind: 'stale', reason: 'Adding files waits for a fresh read of the saved evidence.' }
  }
  if (state.sending) {
    return {
      kind: 'pending',
      reason: 'Adding files waits until the evidence change being sent is confirmed.',
    }
  }
  if (state.unconfirmed) {
    return {
      kind: 'pending',
      reason: 'Adding files waits until the unconfirmed evidence change is retried or discarded.',
    }
  }
  if (state.otherDraftOpen) {
    return {
      kind: 'draft',
      reason: 'Adding files waits until other evidence changes are saved or discarded.',
    }
  }
  return null
}
