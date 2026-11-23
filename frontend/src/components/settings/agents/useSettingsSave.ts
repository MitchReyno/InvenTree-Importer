import { useRef, useState } from 'react'
import { IntakeRequestError, type agentsClient } from '@invimport/contracts/client'
import type { AgentSettingsDto, AgentSettingsUpdateDto } from '@invimport/contracts'
import { useMountedRef } from '#/lifecycle/useMountedRef'
import type { SaveQueue } from './save-queue'

export type SaveState =
  | 'idle'
  /** An autosave is waiting for its debounce or its turn. */
  | 'pending'
  | 'saving'
  | 'saved'
  /** Refused: the settings changed elsewhere, so this save never applied. */
  | 'conflict'
  | 'invalid'
  /** No answer: the save may or may not have applied; resending it is safe. */
  | 'failed'
  /** The server can't tell whether the save applied; only a Reload resolves it. */
  | 'unresolved'
  | 'reloading'
  /** A Reload that didn't answer; the conflict and the edit stay. */
  | 'reloadFailed'

/** What one send of a save established. */
export type SaveOutcome =
  | { kind: 'confirmed'; settings: AgentSettingsDto }
  | { kind: 'conflict' }
  | { kind: 'unknown' }
  | { kind: 'unresolved' }
  | { kind: 'invalid' }

/** The page every subsection saves through: one client, one queue, one confirmed revision. */
export type SettingsPage = {
  client: ReturnType<typeof agentsClient>
  queue: SaveQueue
  /** The newest settings this page knows, read when a save is built. */
  newest: () => AgentSettingsDto
  /**
   * Publishes the settings a confirmed save or reload returns, and answers with the newest
   * settings now known, which may be newer than these.
   */
  adopt: (settings: AgentSettingsDto, source: 'save' | 'reload') => AgentSettingsDto
  /** Records a revision this page's own save produced, known only from its receipt. */
  ownSave: (revision: string) => void
  /** Revisions this page's own saves produced, which an edit may safely move past. */
  localSaves: ReadonlySet<string>
  /** Reports a form's unsaved input to the shared navigation guard. */
  reportDirty: (form: string, dirty: boolean) => void
}

/** States in which what is saved is unknown or contested, so the edit stays until resolved. */
const UNSETTLED: ReadonlySet<SaveState> = new Set([
  'failed',
  'conflict',
  'unresolved',
  'reloadFailed',
])

const STATE_AFTER: Record<SaveOutcome['kind'], SaveState> = {
  confirmed: 'saved',
  conflict: 'conflict',
  unknown: 'failed',
  unresolved: 'unresolved',
  invalid: 'invalid',
}

/** The server's refusals that settle what a save did; anything else may have applied. */
const DEFINITE_REFUSAL: Readonly<Record<string, SaveOutcome>> = {
  revision_conflict: { kind: 'conflict' },
  save_outcome_unknown: { kind: 'unresolved' },
  invalid_agent_settings: { kind: 'invalid' },
  save_receipt_mismatch: { kind: 'invalid' },
}

function refusal(caught: unknown): SaveOutcome {
  const definite = caught instanceof IntakeRequestError ? DEFINITE_REFUSAL[caught.code] : undefined
  return definite ?? { kind: 'unknown' }
}

/**
 * Sends one save. A resend of a save that already applied answers with its receipt, not the
 * settings, which later saves may have changed, so the settings are read after it.
 */
export async function sendSave(
  page: SettingsPage,
  request: AgentSettingsUpdateDto,
): Promise<SaveOutcome> {
  let answer: Awaited<ReturnType<SettingsPage['client']['saveSettings']>>
  try {
    answer = await page.client.saveSettings(request)
  } catch (caught) {
    return refusal(caught)
  }
  if (!('replayed' in answer)) {
    return { kind: 'confirmed', settings: page.adopt(answer, 'save') }
  }
  page.ownSave(answer.revision)
  try {
    const current = await page.client.settings()
    return { kind: 'confirmed', settings: page.adopt(current, 'reload') }
  } catch {
    // Confirmed, but the settings it left are unread; a resend answers with the receipt again.
    return { kind: 'unknown' }
  }
}

/**
 * One subsection's save state, with its sends and reloads. The state is mirrored in a ref, so a
 * queued save reads it when it starts rather than as it was when queued.
 */
export function useSettingsSave(page: SettingsPage) {
  const mounted = useMountedRef()
  const [state, setRenderedState] = useState<SaveState>('idle')
  const current = useRef<SaveState>('idle')

  function setState(next: SaveState) {
    current.current = next
    setRenderedState(next)
  }

  async function send(request: AgentSettingsUpdateDto) {
    setState('saving')
    const outcome = await sendSave(page, request)
    if (mounted.current) {
      setState(STATE_AFTER[outcome.kind])
    }
    return outcome
  }

  async function reload() {
    const after = current.current
    setState('reloading')
    try {
      const settings = await page.client.settings()
      if (!mounted.current) {
        return undefined
      }
      setState('idle')
      return page.adopt(settings, 'reload')
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
    setState,
    /** The state now, for a save or handler that runs after this render. */
    now: () => current.current,
    send,
    reload,
    mounted,
    unsettled: UNSETTLED.has(state),
    /** Whether what is saved is unknown or contested, read now rather than at render. */
    unsettledNow: () => UNSETTLED.has(current.current),
    busy: state === 'saving' || state === 'reloading',
  }
}

export type SettingsSaveChannel = ReturnType<typeof useSettingsSave>
