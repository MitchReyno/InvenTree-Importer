import type { AgentSettingsDto } from '@invimport/contracts'
import { SettingRow, type DisabledControlProps } from '#/components/ui'
import { CheckboxLabel } from '#/forms'
import { SettingsCard } from '#/components/settings/SettingsCard'
import { SaveBar } from './SaveBar'
import { Stack } from './Stack'
import { useSubsectionForm, type SubsectionFormProps } from './useSubsectionForm'

type Values = { publicPages: boolean; datasheets: boolean }

const read = (settings: AgentSettingsDto): Values => ({
  publicPages: settings.web.public_pages,
  datasheets: settings.web.prefer_datasheets,
})

const HELP =
  'For sessions in the VM: whether they can read public pages. Provider web search stays on either way, so search queries go to the session’s provider.'

const NO_WEB =
  'This profile’s sessions have no web access, so these settings don’t apply. Their saved values are kept.'

type Props = SubsectionFormProps & {
  /** The readiness web state; `unavailable` disables both settings without changing them. */
  web: 'available' | 'unavailable' | undefined
}

/** Settings › Agents › Web research: public pages and the datasheet preference, saved together. */
export function WebResearchForm({ web, ...props }: Props) {
  const { form, state, busy, waiting, dirty, markDirty, save, reload, discard } = useSubsectionForm(
    {
      ...props,
      id: 'research',
      read,
      write: ({ publicPages, datasheets }) => ({
        web: { public_pages: publicPages, prefer_datasheets: datasheets },
      }),
    },
  )

  const boxes = (control: { disabled: boolean } | DisabledControlProps) => (
    <>
      <CheckboxLabel>
        <input
          type="checkbox"
          {...control}
          {...form.register('publicPages', { onChange: markDirty })}
        />
        Allow public web pages
      </CheckboxLabel>
      <CheckboxLabel>
        <input
          type="checkbox"
          {...control}
          {...form.register('datasheets', { onChange: markDirty })}
        />
        Prefer manufacturer datasheets over distributor pages
      </CheckboxLabel>
    </>
  )

  return (
    <SettingsCard aria-label="Web research">
      {web === 'unavailable' ? (
        <SettingRow label="Web research" help={HELP} disabledReason={NO_WEB}>
          {({ disabled }) => <Stack>{boxes(disabled)}</Stack>}
        </SettingRow>
      ) : (
        <SettingRow label="Web research" help={HELP}>
          <Stack>
            {boxes({ disabled: busy })}
            <SaveBar
              state={state}
              busy={busy}
              waiting={waiting}
              savedMessage="Saved. Sessions queued from now on use this; queued and running sessions keep theirs."
              onSave={save}
              onReload={reload}
              onDiscard={discard}
              dirty={dirty}
            />
          </Stack>
        </SettingRow>
      )}
    </SettingsCard>
  )
}
