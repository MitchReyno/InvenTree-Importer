import type { AgentSettingsDto } from '@invimport/contracts'
import { SettingRow } from '#/components/ui'
import { CheckboxLabel } from '#/forms'
import { SettingsCard } from '#/components/settings/SettingsCard'
import { AgentAutosaveStatus } from './AgentAutosaveStatus'
import { AgentSubsection } from './AgentSubsection'
import type { FieldKey } from './settings-fields'
import { useSubsectionForm, type SubsectionFormProps } from './useSubsectionForm'

type Values = { auto: boolean }

const KEYS: readonly FieldKey[] = ['auto_tags_default']

const read = (settings: AgentSettingsDto): Values => ({ auto: settings.auto_tags_default })

const write = ({ auto }: Values) => ({ auto_tags_default: auto })

/** Settings › Agents › Tag suggestions: whether new batches start with Auto tags on. */
export function TagSuggestionsForm(props: SubsectionFormProps) {
  const { form, markEdited, autosave } = useSubsectionForm({
    ...props,
    id: 'tags',
    read,
    write,
    keys: KEYS,
  })

  return (
    <AgentSubsection
      id="tags"
      status={
        <AgentAutosaveStatus
          label="Tag suggestions"
          state={autosave.state}
          revision={autosave.revision}
          onRetry={autosave.retry}
          onReload={autosave.reload}
        />
      }
    >
      <SettingsCard aria-label="Tag suggestions">
        <SettingRow
          label="Suggest tags automatically"
          help="New batches start with Auto tags on. Each batch can turn it off in Capture › Batch settings."
        >
          <CheckboxLabel>
            <input
              type="checkbox"
              {...form.register('auto', { onChange: () => markEdited('auto') })}
            />
            Suggest tags for new batches
          </CheckboxLabel>
        </SettingRow>
      </SettingsCard>
    </AgentSubsection>
  )
}
