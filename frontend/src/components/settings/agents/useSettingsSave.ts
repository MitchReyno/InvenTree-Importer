import { useState } from 'react'
import { IntakeRequestError, type agentsClient } from '@invimport/contracts/client'
import type { AgentSettingsDto, AgentSettingsUpdateDto } from '@invimport/contracts'
import { useMountedRef } from '#/lifecycle/useMountedRef'

export type SaveState =
  | 'idle'
  | 'saving'
  | 'saved'
  | 'conflict'
  | 'invalid'
  | 'failed'
  | 'reloading'
  /** A Reload after a conflict that didn't answer; the conflict and the edit stay. */
  | 'reloadFailed'

type Fields = Partial<Omit<AgentSettingsUpdateDto, 'expected_revision'>>

/**
 * Saves one subsection's fields under the loaded revision. Every other field is sent as loaded,
 * never another form's unsaved draft, so subsections save on their own without undoing each other.
 */
export function useSettingsSave({
  client,
  loaded,
  onLoaded,
}: {
  client: ReturnType<typeof agentsClient>
  loaded: AgentSettingsDto
  /** Hears the settings each confirmed save or reload returns. */
  onLoaded: (settings: AgentSettingsDto) => void
}) {
  const mounted = useMountedRef()
  const [state, setState] = useState<SaveState>('idle')

  async function save(fields: Fields) {
    const { revision, ...current } = loaded
    setState('saving')
    try {
      const saved = await client.saveSettings({
        ...current,
        ...fields,
        expected_revision: revision,
      })
      if (mounted.current) {
        onLoaded(saved)
        setState('saved')
      }
      return saved
    } catch (caught) {
      if (mounted.current) {
        const code = caught instanceof IntakeRequestError ? caught.code : undefined
        if (code === 'revision_conflict') {
          setState('conflict')
        } else if (code === 'invalid_agent_settings') {
          setState('invalid')
        } else {
          setState('failed')
        }
      }
      return undefined
    }
  }

  async function reload() {
    const after = state
    setState('reloading')
    try {
      const current = await client.settings()
      if (mounted.current) {
        onLoaded(current)
        setState('idle')
      }
      return current
    } catch {
      if (mounted.current) {
        setState(after === 'conflict' || after === 'reloadFailed' ? 'reloadFailed' : 'failed')
      }
      return undefined
    }
  }

  return {
    state,
    save,
    reload,
    /** A conflict found before sending: these fields changed elsewhere since the edit began. */
    refuse: () => setState('conflict'),
    busy: state === 'saving' || state === 'reloading',
  }
}
