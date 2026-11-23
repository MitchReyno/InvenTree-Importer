import type { AgentSettingsDto } from '@invimport/contracts'
import { SettingRow, type DisabledControlProps } from '#/components/ui'
import { CheckboxLabel } from '#/forms'
import { SettingsCard } from '#/components/settings/SettingsCard'
import { AgentAutosaveStatus } from './AgentAutosaveStatus'
import { AgentSubsection } from './AgentSubsection'
import type { FieldKey } from './settings-fields'
import { Stack } from './Stack'
import { useSubsectionForm, type SubsectionFormProps } from './useSubsectionForm'

type Values = { publicPages: boolean; datasheets: boolean }

const KEYS: readonly FieldKey[] = ['web.public_pages', 'web.prefer_datasheets']

const read = (settings: AgentSettingsDto): Values => ({
  publicPages: settings.web.public_pages,
  datasheets: settings.web.prefer_datasheets,
})

const write = ({ publicPages, datasheets }: Values) => ({
  web: { public_pages: publicPages, prefer_datasheets: datasheets },
})

const HELP =
  'For sessions in the VM: whether they can read public pages. Provider web search stays on either way, so search queries go to the session’s provider.'

const NO_WEB =
  'This profile’s sessions have no web access, so these settings don’t apply. Their saved values are kept.'

const PUBLIC_PAGES = 'Allow public web pages'
const DATASHEETS = 'Prefer manufacturer datasheets over distributor pages'

type Props = SubsectionFormProps & {
  /** The readiness web state; `unavailable` disables both settings without changing them. */
  web: 'available' | 'unavailable' | undefined
}

/** Settings › Agents › Web research: public pages and the datasheet preference, each saving as it changes. */
export function WebResearchForm({ web, ...props }: Props) {
  const { form, markEdited, autosave } = useSubsectionForm({
    ...props,
    id: 'research',
    read,
    write,
    keys: KEYS,
  })
  const status = (
    <AgentAutosaveStatus
      label="Web research"
      state={autosave.state}
      revision={autosave.revision}
      onRetry={autosave.retry}
      onReload={autosave.reload}
    />
  )

  if (web === 'unavailable') {
    // Disabled, they show what is saved; a change made before readiness answered saves as usual.
    const saved = props.loaded.web

    const box = (label: string, checked: boolean, control: DisabledControlProps) => (
      <CheckboxLabel>
        <input type="checkbox" checked={checked} readOnly {...control} />
        {label}
      </CheckboxLabel>
    )

    return (
      <AgentSubsection id="research" status={status}>
        <SettingsCard aria-label="Web research">
          <SettingRow
            label="Web research"
            help={HELP}
            disabledReason={NO_WEB}
            disabledBadge="Not for this profile"
          >
            {({ disabled }) => (
              <Stack>
                {box(PUBLIC_PAGES, saved.public_pages, disabled)}
                {box(DATASHEETS, saved.prefer_datasheets, disabled)}
              </Stack>
            )}
          </SettingRow>
        </SettingsCard>
      </AgentSubsection>
    )
  }

  return (
    <AgentSubsection id="research" status={status}>
      <SettingsCard aria-label="Web research">
        <SettingRow label="Web research" help={HELP}>
          <Stack>
            <CheckboxLabel>
              <input
                type="checkbox"
                {...form.register('publicPages', { onChange: () => markEdited('auto') })}
              />
              {PUBLIC_PAGES}
            </CheckboxLabel>
            <CheckboxLabel>
              <input
                type="checkbox"
                {...form.register('datasheets', { onChange: () => markEdited('auto') })}
              />
              {DATASHEETS}
            </CheckboxLabel>
          </Stack>
        </SettingRow>
      </SettingsCard>
    </AgentSubsection>
  )
}
