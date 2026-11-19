import { useMemo } from 'react'
import {
  useForm,
  type DefaultValues,
  type FieldValues,
  type Path,
  type PathValue,
} from 'react-hook-form'
import type { agentsClient } from '@invimport/contracts/client'
import type { AgentSettingsDto, AgentSettingsUpdateDto } from '@invimport/contracts'
import { useSettingsSave } from './useSettingsSave'

export type SubsectionFormProps = {
  client: ReturnType<typeof agentsClient>
  loaded: AgentSettingsDto
  onLoaded: (settings: AgentSettingsDto) => void
  /** Reports this form's unsaved input to the shared navigation guard. */
  reportDirty: (form: string, dirty: boolean) => void
}

/**
 * One subsection's form over the loaded settings: it follows a newer load while untouched, keeps
 * an edit through another subsection's save, and saves only its own fields.
 */
export function useSubsectionForm<V extends FieldValues>({
  id,
  client,
  loaded,
  onLoaded,
  reportDirty,
  read,
  write,
}: SubsectionFormProps & {
  id: string
  /** The form's values from saved settings; a module-level function, so it stays stable. */
  read: (settings: AgentSettingsDto) => V
  /** The settings fields this form owns, from its values. */
  write: (values: V) => Partial<Omit<AgentSettingsUpdateDto, 'expected_revision'>>
}) {
  const saving = useSettingsSave({ client, loaded, onLoaded })
  const values = useMemo(() => read(loaded), [read, loaded])
  const form = useForm<V>({
    defaultValues: values as DefaultValues<V>,
    values,
    resetOptions: { keepDirtyValues: true },
  })

  function settle(settings: AgentSettingsDto | undefined) {
    if (settings) {
      const next = read(settings)
      form.reset(next)
      // Reset alone leaves an uncontrolled field showing the old text until it re-registers.
      for (const [name, value] of Object.entries(next)) {
        form.setValue(name as Path<V>, value as PathValue<V, Path<V>>)
      }
      reportDirty(id, false)
    }
  }

  return {
    form,
    state: saving.state,
    busy: saving.busy,
    markDirty: () => reportDirty(id, true),
    save: () =>
      void form.handleSubmit(async (current) => settle(await saving.save(write(current))))(),
    reload: () => void saving.reload().then(settle),
  }
}
