import type { ReactNode } from 'react'
import type { AgentSettingsDto } from '@invimport/contracts'
import { NumberStepper, SettingRow, Small } from '#/components/ui'
import { SettingsCard } from '#/components/settings/SettingsCard'
import { SaveBar } from './SaveBar'
import { Stack } from './Stack'
import { useSubsectionForm, type SubsectionFormProps } from './useSubsectionForm'

const MIN_SESSIONS = 1
const MAX_SESSIONS = 8

type Values = { sessions: number }

const read = (settings: AgentSettingsDto): Values => ({ sessions: settings.session_concurrency })

/** Settings › Agents › Sessions: how many sessions run turns at once, for both providers. */
export function SessionsForm({
  slots,
  pause,
  ...props
}: SubsectionFormProps & {
  /** Slot use beside the stepper, from the agent sessions list. */
  slots: ReactNode
  /** The Pause all agents row. */
  pause: ReactNode
}) {
  const { form, state, busy, waiting, dirty, markDirty, save, reload, discard } = useSubsectionForm(
    {
      ...props,
      id: 'sessions',
      read,
      write: ({ sessions }) => ({ session_concurrency: sessions }),
    },
  )

  return (
    <SettingsCard aria-label="Sessions">
      <SettingRow
        label="Sessions at once"
        help="Across all batches and both providers. Sessions waiting for you hold no slot."
      >
        <Stack>
          <NumberStepper
            label="Sessions at once"
            value={form.watch('sessions')}
            min={MIN_SESSIONS}
            max={MAX_SESSIONS}
            aria-disabled={busy || undefined}
            onChange={(value) => {
              if (!busy) {
                // A stepper fires no input event, so it reports to the guard itself.
                form.setValue('sessions', value, { shouldDirty: true })
                markDirty()
              }
            }}
          />
          {slots}
          <Small>
            Lowering it lets running turns finish; queued sessions wait for a free slot.
          </Small>
          <SaveBar
            state={state}
            busy={busy}
            waiting={waiting}
            savedMessage="Saved. The limit applies now: running turns finish, and queued sessions start as slots free up."
            onSave={save}
            onReload={reload}
            onDiscard={discard}
            dirty={dirty}
          />
        </Stack>
      </SettingRow>
      {pause}
    </SettingsCard>
  )
}
