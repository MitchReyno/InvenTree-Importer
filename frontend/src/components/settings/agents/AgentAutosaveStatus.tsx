import { AutosaveStatus, type AutosaveState } from '#/components/ui'
import type { SaveState } from './useSettingsSave'

const SHOWN: Record<Exclude<SaveState, 'idle'>, AutosaveState> = {
  pending: 'pending',
  saving: 'saving',
  saved: 'saved',
  conflict: 'conflict',
  invalid: 'rejected',
  failed: 'unconfirmed',
  unresolved: 'unresolved',
  reloading: 'saving',
  reloadFailed: 'unconfirmed',
}

const CONFLICT = 'Not saved: changed in another tab. Your change is kept here.'

/** A subsection's autosave state beside its heading; nothing until it first saves this visit. */
export function AgentAutosaveStatus({
  label,
  state,
  revision,
  onRetry,
  onReload,
}: {
  label: string
  state: SaveState
  revision: string
  onRetry: () => void
  onReload: () => void
}) {
  if (state === 'idle') {
    return null
  }
  const reloadFailed = state === 'reloadFailed'
  return (
    <AutosaveStatus
      label={label}
      state={SHOWN[state]}
      revision={revision}
      messages={{
        conflict: CONFLICT,
        ...(state === 'reloading' && { saving: 'Reloading…' }),
        ...(reloadFailed && {
          unconfirmed:
            'Not saved, and the saved settings couldn’t be loaded. Your change is kept here.',
        }),
      }}
      retryLabel="Try again"
      // A Reload that failed is tried again with Reload; resending is for an unanswered save.
      onRetry={reloadFailed ? undefined : onRetry}
      onReload={state === 'failed' ? undefined : onReload}
    />
  )
}
