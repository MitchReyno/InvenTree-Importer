import type { AgentSettingsDto } from '@invimport/contracts'
import { SettingRow, Small } from '#/components/ui'
import { TextArea } from '#/forms'
import { SettingsCard } from '#/components/settings/SettingsCard'
import { SaveBar } from './SaveBar'
import { Stack } from './Stack'
import { useSubsectionForm, type SubsectionFormProps } from './useSubsectionForm'
import { storable } from './provider-form'

/** The batch instruction limit, so a copied instruction always fits. */
const MAX_INSTRUCTIONS = 8192

type Values = { text: string }

const read = (settings: AgentSettingsDto): Values => ({ text: settings.new_batch_instructions })

/** Settings › Agents › Instructions: the text copied into each new batch's instructions. */
export function InstructionsForm(props: SubsectionFormProps) {
  const { form, state, busy, waiting, dirty, markDirty, save, reload, discard } = useSubsectionForm(
    {
      ...props,
      id: 'instructions',
      read,
      write: ({ text }) => ({ new_batch_instructions: text }),
    },
  )
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
              aria-describedby={tooLong ? 'instructions-error' : undefined}
              {...form.register('text', {
                // Counted in characters, as the server counts them.
                validate: (value) => [...value].length <= MAX_INSTRUCTIONS && storable(value),
                onChange: markDirty,
              })}
            />
            {tooLong && (
              <Small id="instructions-error" role="alert">
                Up to {MAX_INSTRUCTIONS.toLocaleString()} characters of plain text.
              </Small>
            )}
            <SaveBar
              state={state}
              busy={busy || waiting}
              savedMessage="Saved. Batches created from now on start with these instructions; existing batches keep theirs."
              onSave={save}
              onReload={reload}
              onDiscard={discard}
              dirty={dirty}
            />
          </Stack>
        )}
      </SettingRow>
    </SettingsCard>
  )
}
