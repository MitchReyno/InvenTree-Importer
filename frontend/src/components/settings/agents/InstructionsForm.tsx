import type { AgentSettingsDto } from '@invimport/contracts'
import { SettingRow, Small } from '#/components/ui'
import { TextArea } from '#/forms'
import { SettingsCard } from '#/components/settings/SettingsCard'
import { SaveBar } from './SaveBar'
import { Stack } from './Stack'
import { useSubsectionForm, type SubsectionFormProps } from './useSubsectionForm'

/** The batch instruction limit, so a copied instruction always fits. */
const MAX_INSTRUCTIONS = 8192

type Values = { text: string }

const read = (settings: AgentSettingsDto): Values => ({ text: settings.new_batch_instructions })

/** Settings › Agents › Instructions: the text copied into each new batch's instructions. */
export function InstructionsForm(props: SubsectionFormProps) {
  const { form, state, busy, markDirty, save, reload } = useSubsectionForm({
    ...props,
    id: 'instructions',
    read,
    write: ({ text }) => ({ new_batch_instructions: text }),
  })
  const tooLong = form.formState.errors.text

  return (
    <SettingsCard aria-label="Instructions">
      <SettingRow
        label="Instructions for every new batch"
        help="Copied into a new batch's instructions when it's created. Change them there for one batch; existing batches keep theirs."
      >
        {({ named }) => (
          <Stack>
            <TextArea
              rows={4}
              {...named}
              readOnly={busy}
              aria-invalid={tooLong ? true : undefined}
              {...form.register('text', { maxLength: MAX_INSTRUCTIONS, onChange: markDirty })}
            />
            {tooLong && (
              <Small role="alert">Up to {MAX_INSTRUCTIONS.toLocaleString()} characters.</Small>
            )}
            <SaveBar state={state} busy={busy} onSave={save} onReload={reload} />
          </Stack>
        )}
      </SettingRow>
    </SettingsCard>
  )
}
