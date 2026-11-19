import { useMemo, useRef, useState } from 'react'
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
  /** Publishes confirmed settings and answers with the newest settings known. */
  onLoaded: (settings: AgentSettingsDto, source: 'save' | 'reload') => AgentSettingsDto
  /** Revisions this page's own saves produced, which an edit may safely move past. */
  localSaves: ReadonlySet<string>
  /** Reports this form's unsaved input to the shared navigation guard. */
  reportDirty: (form: string, dirty: boolean) => void
}

type Owned = Partial<Omit<AgentSettingsUpdateDto, 'expected_revision'>>

/**
 * The revision an edit is sent under. Only this page's own saves since the edit began may move
 * it on; a change from elsewhere keeps the edit's revision, so the server refuses it as a conflict.
 */
function expectedRevision(
  base: AgentSettingsDto | undefined,
  loaded: AgentSettingsDto,
  localSaves: ReadonlySet<string>,
) {
  if (!base) {
    return loaded.revision
  }
  for (let revision = BigInt(base.revision) + 1n; revision <= BigInt(loaded.revision); revision++) {
    if (!localSaves.has(revision.toString())) {
      return base.revision
    }
  }
  return loaded.revision
}

/**
 * One subsection's form over the loaded settings: it follows a newer load while untouched, keeps
 * an edit through another subsection's save, and saves only its own fields. An edit made over
 * values that have changed since is a conflict, never sent on top of them.
 */
export function useSubsectionForm<V extends FieldValues>({
  id,
  client,
  loaded,
  onLoaded,
  localSaves,
  reportDirty,
  read,
  write,
}: SubsectionFormProps & {
  id: string
  /** The form's values from saved settings; a module-level function, so it stays stable. */
  read: (settings: AgentSettingsDto) => V
  /** The settings fields this form owns, from its values. */
  write: (values: V) => Owned
}) {
  const saving = useSettingsSave({ client, loaded, onLoaded })
  // The settings the current edit started from, while there is one. The form stays on them, so a
  // newer load never mixes into an edit; it follows newer loads only while untouched.
  const [base, setBase] = useState<AgentSettingsDto | undefined>(undefined)
  const values = useMemo(() => read(loaded), [read, loaded])
  const form = useForm<V>({
    defaultValues: values as DefaultValues<V>,
    values: base ? undefined : values,
  })
  // Held from a press of Save until it settles, so validation can't let a second press through.
  const pending = useRef(false)

  const owned = (settings: AgentSettingsDto) => JSON.stringify(write(read(settings)))

  function settle(settings: AgentSettingsDto | undefined) {
    if (settings) {
      const next = read(settings)
      form.reset(next)
      // Reset alone leaves an uncontrolled field showing the old text until it re-registers.
      for (const [name, value] of Object.entries(next)) {
        form.setValue(name as Path<V>, value as PathValue<V, Path<V>>)
      }
      setBase(undefined)
      reportDirty(id, false)
    }
  }

  return {
    form,
    state: saving.state,
    busy: saving.busy,
    markDirty: () => {
      const start = base ?? loaded
      saving.edited()
      // An edit undone back to its start is no longer unsaved, unless a save's outcome is still
      // unknown: then only a Reload shows what is saved.
      if (!saving.unsettled && JSON.stringify(write(form.getValues())) === owned(start)) {
        setBase(undefined)
        reportDirty(id, false)
        return
      }
      setBase(start)
      reportDirty(id, true)
    },
    /** `check` runs after the conflict check, for rules beyond the fields' own validation. */
    save: (check?: (values: V) => boolean) => {
      if (pending.current || saving.busy) {
        return
      }
      pending.current = true
      void form
        .handleSubmit(async (current) => {
          // Another subsection's save moves the revision on harmlessly; a change to these
          // fields from elsewhere is a conflict this edit hasn't seen.
          if (base && owned(base) !== owned(loaded)) {
            saving.refuse()
            return
          }
          if (check && !check(current)) {
            return
          }
          settle(await saving.save(write(current), expectedRevision(base, loaded, localSaves)))
        })()
        .finally(() => {
          pending.current = false
        })
    },
    reload: () => void saving.reload().then(settle),
    /** Drops the edit for the loaded settings; what the server saved is left as it is. */
    discard: () => {
      if (!saving.busy) {
        settle(loaded)
        saving.discarded()
      }
    },
  }
}
