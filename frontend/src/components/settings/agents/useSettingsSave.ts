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
  /**
   * Publishes the settings a confirmed save or reload returns, and answers with the newest
   * settings now known, which may be newer than these.
   */
  onLoaded: (settings: AgentSettingsDto, source: 'save' | 'reload') => AgentSettingsDto
}) {
  const mounted = useMountedRef()
  const [state, setState] = useState<SaveState>('idle')

  /** `expected` is the revision the edit was made over, when it differs from the loaded one. */
  async function save(fields: Fields, expected = loaded.revision) {
    const { revision: _revision, ...current } = loaded
    setState('saving')
    try {
      const saved = await client.saveSettings({
        ...current,
        ...fields,
        expected_revision: expected,
      })
      // After leaving the section nothing settles, so a late answer can't release another
      // page's navigation guard.
      if (!mounted.current) {
        return undefined
      }
      setState('saved')
      return onLoaded(saved, 'save')
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
      if (!mounted.current) {
        return undefined
      }
      setState('idle')
      return onLoaded(current, 'reload')
    } catch {
      if (mounted.current) {
        // Reload stays offered: the edit is kept and what is saved is still unknown.
        setState(after === 'idle' || after === 'saved' ? 'failed' : 'reloadFailed')
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
    /** Forgets a save's outcome along with the edit it was for. */
    discarded: () => setState('idle'),
    /** "Saved" describes the values shown; a new edit makes it untrue. */
    edited: () => setState((current) => (current === 'saved' ? 'idle' : current)),
    /** Whether what is saved is unknown or contested, so the edit must stay until a Reload. */
    unsettled: state === 'failed' || state === 'conflict' || state === 'reloadFailed',
    busy: state === 'saving' || state === 'reloading',
  }
}
