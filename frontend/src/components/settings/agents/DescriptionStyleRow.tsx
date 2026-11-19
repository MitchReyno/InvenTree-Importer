import type { AgentSettingsDto } from '@invimport/contracts'
import { SettingRow, Small } from '#/components/ui'
import { TextArea } from '#/forms'
import { SaveBar } from './SaveBar'
import { Stack } from './Stack'
import { useSubsectionForm, type SubsectionFormProps } from './useSubsectionForm'

const MAX_STYLE = 500

type Values = { style: string }

const read = (settings: AgentSettingsDto): Values => ({ style: settings.part_description_style })

/** The Part description style agents follow, saved on its own. */
export function DescriptionStyleRow(props: SubsectionFormProps) {
  const { form, state, busy, markDirty, save, reload } = useSubsectionForm({
    ...props,
    id: 'description-style',
    read,
    write: ({ style }) => ({ part_description_style: style }),
  })
  const length = [...form.watch('style')].length
  const tooLong = length > MAX_STYLE

  return (
    <SettingRow
      label="Part description style"
      help="A pattern agents follow, written in plain words. Applies to sessions that start after you save."
    >
      {({ named }) => (
        <Stack>
          <TextArea
            rows={3}
            {...named}
            readOnly={busy}
            aria-invalid={tooLong ? true : undefined}
            {...form.register('style', {
              validate: (value) => [...value].length <= MAX_STYLE,
              onChange: markDirty,
            })}
          />
          <Small role={tooLong ? 'alert' : undefined}>
            {length} of {MAX_STYLE} characters
            {tooLong
              ? ': shorten it to save.'
              : '. Each description stays within 250, InvenTree’s limit.'}
          </Small>
          <SaveBar state={state} busy={busy} onSave={save} onReload={reload} />
        </Stack>
      )}
    </SettingRow>
  )
}
