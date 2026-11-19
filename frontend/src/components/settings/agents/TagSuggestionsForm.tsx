import type { AgentSettingsDto } from '@invimport/contracts'
import { SettingRow } from '#/components/ui'
import { CheckboxLabel } from '#/forms'
import { SettingsCard } from '#/components/settings/SettingsCard'
import { SaveBar } from './SaveBar'
import { Stack } from './Stack'
import { useSubsectionForm, type SubsectionFormProps } from './useSubsectionForm'

type Values = { auto: boolean }

const read = (settings: AgentSettingsDto): Values => ({ auto: settings.auto_tags_default })

/** Settings › Agents › Tag suggestions: whether new batches start with Auto tags on. */
export function TagSuggestionsForm(props: SubsectionFormProps) {
  const { form, state, busy, markDirty, save, reload } = useSubsectionForm({
    ...props,
    id: 'tags',
    read,
    write: ({ auto }) => ({ auto_tags_default: auto }),
  })

  return (
    <SettingsCard aria-label="Tag suggestions">
      <SettingRow
        label="Suggest tags automatically"
        help="New batches start with Auto tags on. Each batch can turn it off in Capture › Batch settings."
      >
        <Stack>
          <CheckboxLabel>
            <input
              type="checkbox"
              disabled={busy}
              {...form.register('auto', { onChange: markDirty })}
            />
            Suggest tags for new batches
          </CheckboxLabel>
          <SaveBar state={state} busy={busy} onSave={save} onReload={reload} />
        </Stack>
      </SettingRow>
    </SettingsCard>
  )
}
