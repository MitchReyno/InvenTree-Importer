import type { AgentSettingsDto } from '@invimport/contracts'
import { SettingRow, Small } from '#/components/ui'
import { TextArea } from '#/forms'
import { SettingsCard } from '#/components/settings/SettingsCard'
import { SaveBar } from './SaveBar'
import { Stack } from './Stack'
import { useSubsectionForm, type SubsectionFormProps } from './useSubsectionForm'
import { storable } from './provider-form'
import type { FieldKey } from './settings-fields'

/** The batch instruction limit, so a copied instruction always fits. */
const MAX_INSTRUCTIONS = 8192

type Values = { text: string }

const KEYS: readonly FieldKey[] = ['new_batch_instructions']

const read = (settings: AgentSettingsDto): Values => ({ text: settings.new_batch_instructions })

const write = ({ text }: Values) => ({ new_batch_instructions: text })

/** Settings › Agents › Instructions: the text copied into each new batch's instructions. */
export function InstructionsForm(props: SubsectionFormProps) {
  const { form, markEdited, text } = useSubsectionForm({
    ...props,
    id: 'instructions',
    read,
    write,
    keys: KEYS,
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
              readOnly={text.busy}
              aria-invalid={tooLong ? true : undefined}
              aria-describedby={tooLong ? 'instructions-error' : undefined}
              {...form.register('text', {
                // Counted in characters, as the server counts them.
                validate: (value) => [...value].length <= MAX_INSTRUCTIONS && storable(value),
                onChange: () => markEdited('text'),
              })}
            />
            {tooLong && (
              <Small id="instructions-error" role="alert">
                Up to {MAX_INSTRUCTIONS.toLocaleString()} characters of plain text.
              </Small>
            )}
            <SaveBar
              state={text.state}
              busy={text.busy}
              waiting={text.waiting}
              savedMessage="Saved. Batches created from now on start with these instructions; existing batches keep theirs."
              onSave={() => text.save()}
              onRetry={text.retry}
              onReload={text.reload}
              onDiscard={text.discard}
              dirty={text.dirty}
            />
          </Stack>
        )}
      </SettingRow>
    </SettingsCard>
  )
}
