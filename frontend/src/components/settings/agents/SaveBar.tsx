import styled from 'styled-components'
import { Banner, Button, Small } from '#/components/ui'
import { color, space } from '#/theme/generated/tokens'
import type { SaveState } from './useSettingsSave'

const CONFLICT =
  'These settings changed in another tab, so this save was refused. Your edit is kept here; Reload to see the saved settings.'

const MESSAGE: Partial<Record<SaveState, string>> = {
  saved: 'Saved. Sessions queued from now on use it; queued and running ones keep theirs.',
  invalid: 'The server refused these settings. Check the fields above and save again.',
}

/** States where what is saved is unknown or contested, so Reload is offered. */
const RELOAD: Partial<Record<SaveState, string>> = {
  conflict: CONFLICT,
  failed:
    'The save wasn’t confirmed: the server didn’t answer. Your edit is kept here; Try again sends the same save, and Reload shows what was saved.',
  reloadFailed:
    'The saved settings couldn’t be loaded. Your edit is kept here; try Reload again, or discard your edit, which leaves whatever was saved as it is.',
  unresolved:
    'Couldn’t confirm this change: the server can’t tell whether it was saved. Reload to see the saved settings.',
}

/** A save sent again unchanged is safe only while its outcome is simply unknown. */
const TRY_AGAIN: ReadonlySet<SaveState> = new Set(['failed'])
/** Only a Reload resolves these, so the edit can't be discarded first. */
const RELOAD_ONLY: ReadonlySet<SaveState> = new Set(['unresolved'])

/**
 * A text field's Save and Discard, shown while it holds an edit, with what its last save or
 * reload did.
 */
export function SaveBar({
  state,
  busy,
  label = 'Save',
  savedMessage = MESSAGE.saved,
  dirty = false,
  waiting = false,
  onSave,
  onRetry,
  onReload,
  onDiscard,
}: {
  state: SaveState
  busy: boolean
  label?: string
  /** What a confirmed save means for this form. */
  savedMessage?: string
  /** Whether the form has an edit, which Discard my edit can drop. */
  dirty?: boolean
  /** Another subsection's save is running: this Save waits, recovery stays available. */
  waiting?: boolean
  onSave: () => void
  /** Sends the same save again after it got no answer. */
  onRetry?: () => void
  /** Loads the saved settings into this form, dropping its edit. */
  onReload: () => void
  /** Drops this form's edit without learning what is saved, for when Reload keeps failing. */
  onDiscard: () => void
}) {
  const message = state === 'saved' ? savedMessage : MESSAGE[state]
  // Until a Reload shows what is saved, another Save could hide an earlier one's outcome.
  const blocked = busy || waiting || RELOAD[state] !== undefined
  if (!dirty && !message && !RELOAD[state]) {
    return null
  }

  return (
    <Bar>
      {dirty && (
        <Button
          type="button"
          variant="primary"
          aria-disabled={blocked || undefined}
          onClick={() => {
            if (!blocked) {
              onSave()
            }
          }}
        >
          {state === 'saving' ? 'Saving…' : label}
        </Button>
      )}
      {dirty && !busy && !RELOAD[state] && (
        <Button type="button" variant="ghost" onClick={() => onDiscard()}>
          Discard my edit
        </Button>
      )}
      {RELOAD[state] && (
        <div role="alert">
          <Banner
            tone="warn"
            action={
              <>
                {TRY_AGAIN.has(state) && onRetry && (
                  <Button type="button" aria-disabled={busy || undefined} onClick={() => onRetry()}>
                    Try again
                  </Button>
                )}
                <Button type="button" aria-disabled={busy || undefined} onClick={() => onReload()}>
                  Reload
                </Button>
                {!RELOAD_ONLY.has(state) && (
                  <Button
                    type="button"
                    variant="ghost"
                    aria-disabled={busy || undefined}
                    onClick={() => onDiscard()}
                  >
                    Discard my edit
                  </Button>
                )}
              </>
            }
          >
            {RELOAD[state]}
          </Banner>
        </div>
      )}
      {message && <Small role="status">{message}</Small>}
    </Bar>
  )
}

const Bar = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[4]};
  small {
    color: ${color.muted};
  }
`
