import styled from 'styled-components'
import { Banner, Button, Small } from '#/components/ui'
import { color, space } from '#/theme/generated/tokens'
import type { SaveState } from './useSettingsSave'

const CONFLICT =
  'These settings changed in another tab, so this save was refused. Your edit is kept here; Reload to see the saved settings.'

const MESSAGE: Partial<Record<SaveState, string>> = {
  saved: 'Saved. Sessions that start from now on use it; running ones keep theirs.',
  invalid: 'The server refused these settings. Check the fields above and save again.',
  failed: 'Not saved: the server didn’t answer. Your edit is kept here; try again.',
}

/** One subsection's Save, with what its last save or reload did. */
export function SaveBar({
  state,
  busy,
  label = 'Save',
  onSave,
  onReload,
}: {
  state: SaveState
  busy: boolean
  label?: string
  onSave: () => void
  /** Loads the saved settings into this form, dropping its edit. */
  onReload: () => void
}) {
  const message = MESSAGE[state]

  return (
    <Bar>
      <Button type="button" variant="primary" aria-disabled={busy || undefined} onClick={onSave}>
        {state === 'saving' ? 'Saving…' : label}
      </Button>
      {state === 'conflict' && (
        <div role="alert">
          <Banner
            tone="warn"
            action={
              <Button type="button" aria-disabled={busy || undefined} onClick={onReload}>
                Reload
              </Button>
            }
          >
            {CONFLICT}
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
