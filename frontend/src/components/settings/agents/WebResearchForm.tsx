import styled from 'styled-components'
import type { AgentSettingsDto } from '@invimport/contracts'
import { Button, SettingRow, type DisabledControlProps } from '#/components/ui'
import { CheckboxLabel } from '#/forms'
import { space } from '#/theme/generated/tokens'
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

const PUBLIC_PAGES = 'Allow public web pages'
const DATASHEETS = 'Prefer manufacturer datasheets over distributor pages'

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

  if (web === 'unavailable') {
    // Disabled, they show what is saved, never a draft; a draft made before readiness answered
    // can still be dropped.
    const saved = props.loaded.web

    const box = (label: string, checked: boolean, control: DisabledControlProps) => (
      <CheckboxLabel>
        <input type="checkbox" checked={checked} readOnly {...control} />
        {label}
      </CheckboxLabel>
    )

    return (
      <SettingsCard aria-label="Web research">
        <SettingRow label="Web research" help={HELP} disabledReason={NO_WEB}>
          {({ disabled }) => (
            <Stack>
              {box(PUBLIC_PAGES, saved.public_pages, disabled)}
              {box(DATASHEETS, saved.prefer_datasheets, disabled)}
            </Stack>
          )}
        </SettingRow>
        {/* Outside the disabled row, which refuses every press within it. */}
        {dirty && (
          <Discard>
            <Button type="button" variant="ghost" onClick={() => discard()}>
              Discard my edit
            </Button>
          </Discard>
        )}
      </SettingsCard>
    )
  }

  return (
    <SettingsCard aria-label="Web research">
      <SettingRow label="Web research" help={HELP}>
        <Stack>
          <CheckboxLabel>
            <input
              type="checkbox"
              disabled={busy}
              {...form.register('publicPages', { onChange: markDirty })}
            />
            {PUBLIC_PAGES}
          </CheckboxLabel>
          <CheckboxLabel>
            <input
              type="checkbox"
              disabled={busy}
              {...form.register('datasheets', { onChange: markDirty })}
            />
            {DATASHEETS}
          </CheckboxLabel>
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
    </SettingsCard>
  )
}

const Discard = styled.div`
  padding: 0 ${space[8]} ${space[8]};
`
