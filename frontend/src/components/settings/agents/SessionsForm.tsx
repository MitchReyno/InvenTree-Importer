import type { ReactNode } from 'react'
import type { AgentSettingsDto } from '@invimport/contracts'
import { NumberStepper, SettingRow, Small } from '#/components/ui'
import { SettingsCard } from '#/components/settings/SettingsCard'
import { AgentAutosaveStatus } from './AgentAutosaveStatus'
import { AgentSubsection } from './AgentSubsection'
import type { FieldKey } from './settings-fields'
import { Stack } from './Stack'
import { useSubsectionForm, type SubsectionFormProps } from './useSubsectionForm'

const MIN_SESSIONS = 1
const MAX_SESSIONS = 8

type Values = { sessions: number }

const KEYS: readonly FieldKey[] = ['session_concurrency']

const read = (settings: AgentSettingsDto): Values => ({ sessions: settings.session_concurrency })

const write = ({ sessions }: Values) => ({ session_concurrency: sessions })

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
  const { form, markEdited, autosave } = useSubsectionForm({
    ...props,
    id: 'sessions',
    read,
    write,
    keys: KEYS,
  })

  return (
    <AgentSubsection
      id="sessions"
      status={
        <AgentAutosaveStatus
          label="Sessions"
          state={autosave.state}
          revision={autosave.revision}
          onRetry={autosave.retry}
          onReload={autosave.reload}
        />
      }
    >
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
              onChange={(value) => {
                // A stepper fires no input event, so it reports its edit itself.
                form.setValue('sessions', value, { shouldDirty: true })
                markEdited('auto')
              }}
            />
            {slots}
            <Small>
              Lowering it lets running turns finish; queued sessions wait for a free slot.
            </Small>
          </Stack>
        </SettingRow>
        {pause}
      </SettingsCard>
    </AgentSubsection>
  )
}
