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
    'The save wasn’t confirmed: the server didn’t answer. Your edit is kept here; Reload shows what was saved.',
  reloadFailed:
    'The saved settings couldn’t be loaded. Your edit is kept here; try Reload again, or discard your edit, which leaves whatever was saved as it is.',
}

/** One subsection's Save, with what its last save or reload did. */
export function SaveBar({
  state,
  busy,
  label = 'Save',
  savedMessage = MESSAGE.saved,
  onSave,
  onReload,
  onDiscard,
}: {
  state: SaveState
  busy: boolean
  label?: string
  /** What a confirmed save means for this form. */
  savedMessage?: string
  onSave: () => void
  /** Loads the saved settings into this form, dropping its edit. */
  onReload: () => void
  /** Drops this form's edit without learning what is saved, for when Reload keeps failing. */
  onDiscard: () => void
}) {
  const message = state === 'saved' ? savedMessage : MESSAGE[state]
  // Until a Reload shows what is saved, another Save could hide an earlier one's outcome.
  const blocked = busy || RELOAD[state] !== undefined

  return (
    <Bar>
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
      {RELOAD[state] && (
        <div role="alert">
          <Banner
            tone="warn"
            action={
              <>
                <Button type="button" aria-disabled={busy || undefined} onClick={() => onReload()}>
                  Reload
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  aria-disabled={busy || undefined}
                  onClick={() => onDiscard()}
                >
                  Discard my edit
                </Button>
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
