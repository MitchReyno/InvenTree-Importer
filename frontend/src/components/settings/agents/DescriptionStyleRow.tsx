import type { AgentSettingsDto } from '@invimport/contracts'
import { SettingRow, Small } from '#/components/ui'
import { TextArea } from '#/forms'
import { SaveBar } from './SaveBar'
import { Stack } from './Stack'
import { useSubsectionForm, type SubsectionFormProps } from './useSubsectionForm'
import { storable } from './provider-form'
import type { FieldKey } from './settings-fields'

const MAX_STYLE = 500

type Values = { style: string }

const KEYS: readonly FieldKey[] = ['part_description_style']

const read = (settings: AgentSettingsDto): Values => ({ style: settings.part_description_style })

const write = ({ style }: Values) => ({ part_description_style: style })

/** The Part description style agents follow, saved on its own. */
export function DescriptionStyleRow(props: SubsectionFormProps) {
  const { form, markEdited, text } = useSubsectionForm({
    ...props,
    id: 'description-style',
    read,
    write,
    keys: KEYS,
  })
  const length = [...form.watch('style')].length
  const tooLong = length > MAX_STYLE

  return (
    <SettingRow
      label="Part description style"
      help="A pattern agents follow, written in plain words. Applies to sessions queued after you save."
    >
      {({ named }) => (
        <Stack>
          <TextArea
            rows={3}
            {...named}
            readOnly={text.busy}
            aria-invalid={tooLong ? true : undefined}
            {...form.register('style', {
              validate: (value) => [...value].length <= MAX_STYLE && storable(value),
              onChange: () => markEdited('text'),
            })}
          />
          <Small role={tooLong ? 'alert' : undefined}>
            {length} of {MAX_STYLE} characters
            {tooLong
              ? ': shorten it to save.'
              : '. Each description stays within 250, InvenTree’s limit.'}
          </Small>
          <SaveBar
            state={text.state}
            busy={text.busy}
            waiting={text.waiting}
            onSave={() => text.save()}
            onRetry={text.retry}
            onReload={text.reload}
            onDiscard={() => text.discard()}
            dirty={text.dirty}
          />
        </Stack>
      )}
    </SettingRow>
  )
}
