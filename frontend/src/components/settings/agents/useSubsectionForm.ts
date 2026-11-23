import { useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react'
import {
  useForm,
  type DefaultValues,
  type FieldValues,
  type Path,
  type PathValue,
} from 'react-hook-form'
import type {
  AgentProviderId,
  AgentSettingsDto,
  AgentSettingsStage,
  AgentSettingsUpdateDto,
} from '@invimport/contracts'
import { validModel } from './provider-form'
import type { SaveResult } from './save-queue'
import {
  fieldValue,
  sameField,
  withFields,
  withUsableProviders,
  type FieldKey,
  type SettingsFields,
} from './settings-fields'
import { useSettingsSave, type SettingsPage, type SettingsSaveChannel } from './useSettingsSave'

export type SubsectionFormProps = {
  page: SettingsPage
  /** The shared settings read, which an untouched form follows. */
  loaded: AgentSettingsDto
}

/** How an edit saves: on its own after a pause, or with its subsection's Save. */
export type SaveMode = 'auto' | 'text'

/** Rapid changes, such as stepper clicks, coalesce into one save sent after this pause. */
export const AUTOSAVE_DELAY_MS = 600
/** Pauses before resending a save that got no answer; after the last, Try again is offered. */
const RESEND_DELAYS_MS = [1000, 2000, 4000]

/** A save as sent: its request and the fields it carries for this form. */
type SentSave = { request: AgentSettingsUpdateDto; keys: FieldKey[] }

/**
 * What Try again resolves: a save whose outcome is unknown or contested, resent as it was; a
 * confirmed save whose settings are still unread; or a save that failed before it was sent.
 */
type Unresolved =
  { kind: 'send'; save: SentSave } | { kind: 'read' } | { kind: 'rebuild'; scope: KeyScope }

/**
 * Why a provider switch was refused: it was the last provider on, or its saved default model is
 * not a model ID.
 */
export type ProviderKept = 'last' | 'model'

/** Which of the form's fields an action covers; all of them by default. */
type KeyScope = (key: FieldKey) => boolean

const EVERY_KEY: KeyScope = () => true

function fieldsOf(settings: AgentSettingsDto): SettingsFields {
  const { revision: _revision, ...fields } = settings
  return fields
}

/**
 * The revision an edit is sent under. Only this page's own saves since the edit began may move
 * it on; a change from elsewhere keeps the edit's revision, so the server refuses it as a conflict.
 */
function expectedRevision(
  base: AgentSettingsDto,
  newest: AgentSettingsDto,
  localSaves: ReadonlySet<string>,
) {
  for (let revision = BigInt(base.revision) + 1n; revision <= BigInt(newest.revision); revision++) {
    if (!localSaves.has(revision.toString())) {
      return base.revision
    }
  }
  return newest.revision
}

/**
 * One subsection's form over the shared settings. Non-text edits save on their own after a
 * pause; text edits wait for Save. Each save is built when it is sent, from the newest settings
 * this page confirmed plus only the fields this form changed, and goes through the page's queue.
 * An edited form stays on the settings it started from, so a newer load never mixes into it.
 */
export function useSubsectionForm<V extends FieldValues>({
  id,
  page,
  loaded,
  read,
  write,
  keys,
  onStepsReset,
  onProviderKept,
}: SubsectionFormProps & {
  id: string
  /** The form's values from saved settings; a module-level function, so it stays stable. */
  read: (settings: AgentSettingsDto) => V
  /** The settings fields the form's values set. */
  write: (values: V) => Partial<SettingsFields>
  /** The fields this form's controls change. */
  keys: readonly FieldKey[]
  /** Steps a save reset to Default because their provider is off. */
  onStepsReset?: (steps: readonly AgentSettingsStage[]) => void
  /** A provider switch refused at dispatch, and why. */
  onProviderKept?: (provider: AgentProviderId, reason: ProviderKept) => void
}) {
  const auto = useSettingsSave(page)
  const text = useSettingsSave(page)
  const channels: Record<SaveMode, SettingsSaveChannel> = { auto, text }
  const owners: Record<SaveMode, string> = { auto: id, text: `${id}:text` }
  const queue = useSyncExternalStore(page.queue.subscribe, page.queue.snapshot)
  // The settings the current edit started from, while there is one.
  const [base, setBaseState] = useState<AgentSettingsDto | undefined>(undefined)
  const baseRef = useRef<AgentSettingsDto | undefined>(undefined)
  const values = useMemo(() => read(loaded), [read, loaded])
  const form = useForm<V>({
    defaultValues: values as DefaultValues<V>,
    values: base ? undefined : values,
  })
  /** Each changed field and how it saves, until a confirmed save or a reload settles it. */
  const touched = useRef(new Map<FieldKey, SaveMode>())
  /** The draft as of the last edit, so the next edit can tell which fields it changed. */
  const shown = useRef<SettingsFields | undefined>(undefined)
  const unresolved = useRef<Partial<Record<SaveMode, Unresolved>>>({})
  const resendTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const savedOnce = useRef(false)
  /** Steps whose provider the operator chose here, apart from a model typed for them. */
  const providerEdits = useRef(new Set<FieldKey>())
  /** The fields the last text Save covered, kept for its Try again. */
  const textScope = useRef<KeyScope>(EVERY_KEY)
  /** Counts Reloads, so a recovery that a Reload superseded settles nothing. */
  const recovery = useRef(0)
  // Held from a press of Save until it settles, so validation can't let a second press through.
  const pendingText = useRef(false)
  const [, rerender] = useReducer((count: number) => count + 1, 0)

  // The resend timer is this form's own; the page owns the debounce and drops it on leaving.
  useEffect(
    () => () => {
      clearTimeout(resendTimer.current)
    },
    [],
  )

  function setBase(next: AgentSettingsDto | undefined) {
    baseRef.current = next
    setBaseState(next)
  }

  /** The form's values over `start`, copied: the form's own values change in place. */
  function draftOver(start: AgentSettingsDto): SettingsFields {
    return structuredClone({ ...fieldsOf(start), ...write(form.getValues()) })
  }

  function touchedIn(mode: SaveMode) {
    return [...touched.current].filter(([, saves]) => saves === mode).map(([key]) => key)
  }

  function unsettledNow() {
    return auto.unsettledNow() || text.unsettledNow()
  }

  function dirtyNow() {
    return touched.current.size > 0 || unsettledNow() || page.queue.pending(owners.auto)
  }

  function report() {
    page.reportDirty(id, dirtyNow())
    rerender()
  }

  function showValues(next: V) {
    form.reset(next, { keepDefaultValues: true })
    // Reset alone leaves an uncontrolled field showing the old text until it re-registers.
    for (const [name, value] of Object.entries(next)) {
      form.setValue(name as Path<V>, value as PathValue<V, Path<V>>)
    }
  }

  /** Shows `settings` and forgets the edit: nothing is left unsaved. */
  function settle(settings: AgentSettingsDto) {
    showValues(read(settings))
    touched.current.clear()
    providerEdits.current.clear()
    shown.current = undefined
    setBase(undefined)
    page.reportDirty(id, false)
    rerender()
  }

  /** Moves the edit onto `settings`: its drafts stay, every other field shows `settings`. */
  function rebase(settings: AgentSettingsDto) {
    const draft = draftOver(baseRef.current ?? settings)
    // A model draft belongs to its step's provider: if that changed elsewhere, the draft goes.
    for (const key of touchedIn('text')) {
      if (!providerEdits.current.has(key) && providerChanged(draft, fieldsOf(settings), key)) {
        touched.current.delete(key)
      }
    }
    const next = withFields(fieldsOf(settings), draft, touched.current.keys())
    showValues(read({ ...next, revision: settings.revision }))
    shown.current = next
    setBase(settings)
    report()
  }

  /** Settles the form once nothing is left to save or resolve; otherwise reports what is. */
  function tidy(settings: AgentSettingsDto) {
    if (!dirtyNow()) {
      settle(settings)
    } else {
      report()
    }
  }

  /**
   * Records an edit the operator just made. Non-text edits are saved after a pause, or at once
   * when `now`; text edits wait for Save. Call from the control's own event.
   */
  function markEdited(mode: SaveMode, { now = false }: { now?: boolean } = {}) {
    const start = baseRef.current ?? loaded
    if (!baseRef.current) {
      setBase(start)
    }
    const draft = draftOver(start)
    const previous = shown.current ?? fieldsOf(start)
    for (const key of keys) {
      if (!sameField(draft, previous, key)) {
        touched.current.set(key, mode)
        if (mode === 'auto' && providerChanged(draft, previous, key)) {
          providerEdits.current.add(key)
        }
      }
    }
    shown.current = draft
    if (mode === 'auto') {
      // An unknown or contested outcome stays shown; this edit waits behind it.
      if (!auto.unsettledNow()) {
        auto.setState('pending')
      }
      page.queue.schedule(owners.auto, () => guarded('auto'), now ? 0 : AUTOSAVE_DELAY_MS)
    } else {
      if (text.now() === 'saved') {
        text.setState('idle')
      }
      // A text field undone back to its start is no longer unsaved, unless a save's outcome is
      // still unknown: then only a Reload shows what is saved.
      if (!text.unsettledNow()) {
        for (const key of touchedIn('text')) {
          if (sameField(draft, fieldsOf(start), key)) {
            touched.current.delete(key)
          }
        }
      }
    }
    if (!dirtyNow()) {
      shown.current = undefined
      setBase(undefined)
    }
    report()
  }

  /**
   * Runs a save job, turning an unexpected failure into a failed save Try again can rebuild,
   * so the queue is never left held with nothing to release it.
   */
  async function guarded(mode: SaveMode, scope: KeyScope = EVERY_KEY): Promise<SaveResult> {
    try {
      return await buildAndSend(mode, scope)
    } catch {
      if (!unresolved.current[mode]) {
        unresolved.current[mode] = { kind: 'rebuild', scope }
      }
      channels[mode].setState('failed')
      report()
      return 'hold'
    }
  }

  /** Builds this form's save for `mode` from the newest confirmed settings, and sends it. */
  async function buildAndSend(mode: SaveMode, scope: KeyScope = EVERY_KEY): Promise<SaveResult> {
    const channel = channels[mode]
    if (!channel.mounted.current) {
      return 'done'
    }
    const newest = page.newest()
    const start = baseRef.current ?? newest
    const draft = draftOver(start)
    const confirmed = fieldsOf(newest)
    const owned = touchedIn(mode).filter(scope)
    const changed = owned.filter((key) => !sameField(draft, confirmed, key))
    // Fields already as confirmed have nothing to send.
    for (const key of owned) {
      if (!changed.includes(key)) {
        touched.current.delete(key)
      }
    }
    // Interim, until the model picker: a step's new provider autosaves with its saved default
    // model, while a model typed for it waits for Save.
    const stepProviders =
      mode === 'auto'
        ? touchedIn('text').filter(
            (key) => providerEdits.current.has(key) && providerChanged(draft, confirmed, key),
          )
        : []
    changed.push(...stepProviders)
    if (changed.length === 0) {
      channel.setState(mode === 'auto' && savedOnce.current ? 'saved' : 'idle')
      tidy(newest)
      return 'done'
    }
    const expected = expectedRevision(start, newest, page.localSaves)
    const changedElsewhere = changed.some((key) => !sameField(fieldsOf(start), confirmed, key))
    if (expected !== newest.revision && changedElsewhere) {
      // A change to these fields from elsewhere is a conflict this edit hasn't seen.
      channel.setState('conflict')
      report()
      return 'hold'
    }
    const composed = withStepProviderDefaults(withFields(confirmed, draft, changed), stepProviders)
    const sent = validatedAtDispatch(composed, confirmed, changed)
    if (sent.keys.every((key) => sameField(sent.settings, confirmed, key))) {
      // Validation left nothing to change.
      for (const key of sent.keys) {
        touched.current.delete(key)
      }
      channel.setState(mode === 'auto' && savedOnce.current ? 'saved' : 'idle')
      tidy(newest)
      return 'done'
    }
    const request: AgentSettingsUpdateDto = {
      ...sent.settings,
      expected_revision: expected,
      save_id: crypto.randomUUID(),
    }
    return deliver(mode, { request, keys: sent.keys })
  }

  /** A step whose provider differs from the confirmed one; its model is another matter. */
  function providerChanged(draft: SettingsFields, confirmed: SettingsFields, key: FieldKey) {
    if (!key.startsWith('stage_selections.')) {
      return false
    }
    const stage = key.slice('stage_selections.'.length) as AgentSettingsStage
    return draft.stage_selections[stage]?.provider !== confirmed.stage_selections[stage]?.provider
  }

  /** Each listed step on its provider's saved default model, never a typed model draft. */
  function withStepProviderDefaults(settings: SettingsFields, steps: FieldKey[]) {
    const next = structuredClone(settings)
    for (const key of steps) {
      const stage = key.slice('stage_selections.'.length) as AgentSettingsStage
      const choice = next.stage_selections[stage]
      if (choice) {
        next.stage_selections[stage] = {
          provider: choice.provider,
          model: settings.providers[choice.provider].default_model,
        }
      }
    }
    return next
  }

  /**
   * A queued step choice for a provider that is now off is dropped: the step goes back to
   * Default, with the reset note, and the save carries the reset instead.
   */
  function validatedAtDispatch(
    composed: SettingsFields,
    confirmed: SettingsFields,
    changed: FieldKey[],
  ) {
    const settings = withProvidersKept(composed, confirmed, changed)
    const usable = withUsableProviders(settings)
    const adjusted = keys.filter((key) => !sameField(usable.settings, settings, key))
    if (adjusted.length > 0) {
      const draft = draftOver(baseRef.current ?? loaded)
      const next = withFields(draft, usable.settings, adjusted)
      showValues(read({ ...next, revision: (baseRef.current ?? loaded).revision }))
      shown.current = next
      for (const key of adjusted) {
        touched.current.set(key, 'auto')
      }
    }
    if (usable.reset.length > 0) {
      onStepsReset?.(usable.reset)
    }
    const sentKeys = [...new Set([...changed, ...adjusted])]
    return { settings: usable.settings, keys: sentKeys }
  }

  /**
   * Provider switches checked again at dispatch. At least one provider stays on: turning one off
   * while another tab turned the other off keeps it on. A provider whose saved default model is
   * not a model ID stays off. Either way its step and default choices go back as confirmed, and
   * the card says why.
   */
  function withProvidersKept(
    settings: SettingsFields,
    confirmed: SettingsFields,
    changed: FieldKey[],
  ) {
    const switched = changed.filter((key) => key.endsWith('.enabled'))
    const turnedOff = switched.filter((key) => fieldValue(settings, key) === false)
    const turnedOnWithoutModel = switched.filter((key) => {
      const provider = key.split('.')[1] as AgentProviderId
      return (
        fieldValue(settings, key) === true &&
        !validModel(settings.providers[provider].default_model, true)
      )
    })
    const noneOn = !settings.providers.claude.enabled && !settings.providers.codex.enabled
    const kept: [FieldKey[], ProviderKept][] = [
      [noneOn ? turnedOff : [], 'last'],
      [turnedOnWithoutModel, 'model'],
    ]
    if (kept.every(([refused]) => refused.length === 0)) {
      return settings
    }
    const providerChoices = changed.filter(
      (key) =>
        key.endsWith('.enabled') ||
        key === 'default_provider' ||
        key.startsWith('stage_selections.'),
    )
    for (const key of providerChoices) {
      touched.current.delete(key)
      providerEdits.current.delete(key)
      changed.splice(changed.indexOf(key), 1)
    }
    const restored = withFields(settings, confirmed, providerChoices)
    const draft = draftOver(baseRef.current ?? loaded)
    const shownNow = withFields(draft, restored, providerChoices)
    showValues(read({ ...shownNow, revision: (baseRef.current ?? loaded).revision }))
    shown.current = shownNow
    for (const [refused, reason] of kept) {
      for (const key of refused) {
        onProviderKept?.(key.split('.')[1] as AgentProviderId, reason)
      }
    }
    return restored
  }

  /** Sends a save and records what is now known of it; `attempt` counts automatic resends. */
  async function deliver(mode: SaveMode, save: SentSave, attempt = 0): Promise<SaveResult> {
    const channel = channels[mode]
    const outcome = await channel.send(save.request)
    if (!channel.mounted.current) {
      return 'done'
    }
    switch (outcome.kind) {
      case 'confirmed': {
        unresolved.current[mode] = undefined
        acknowledge(mode, save, outcome.settings)
        tidy(outcome.settings)
        return 'done'
      }
      case 'confirmedUnread':
        // Confirmed by its receipt; only the settings it left are still to be read.
        acknowledge(mode, save, baseRef.current ?? loaded)
        unresolved.current[mode] = { kind: 'read' }
        scheduleResend(mode, attempt)
        report()
        return 'hold'
      case 'invalid':
        unresolved.current[mode] = undefined
        report()
        return 'done'
      case 'conflict':
      case 'unresolved':
        unresolved.current[mode] = { kind: 'send', save }
        report()
        return 'hold'
      case 'unknown':
        unresolved.current[mode] = { kind: 'send', save }
        scheduleResend(mode, attempt)
        report()
        return 'hold'
    }
  }

  /** Only the draft actually sent is acknowledged; a later edit saves again. */
  function acknowledge(mode: SaveMode, save: SentSave, settings: AgentSettingsDto) {
    const draft = draftOver(baseRef.current ?? settings)
    for (const key of save.keys) {
      if (sameField(draft, save.request, key)) {
        touched.current.delete(key)
      }
      if (!providerChanged(draft, save.request, key)) {
        providerEdits.current.delete(key)
      }
    }
    if (mode === 'auto') {
      savedOnce.current = true
    }
  }

  /** Reads the settings a confirmed save left, after its own read failed. */
  async function readAfterConfirmed(mode: SaveMode, attempt: number): Promise<SaveResult> {
    const channel = channels[mode]
    const started = recovery.current
    channel.setState('reloading')

    const superseded = () => !channel.mounted.current || recovery.current !== started

    try {
      const read = await page.client.settings()
      if (superseded()) {
        return 'done'
      }
      const settings = page.adopt(read, 'reload')
      unresolved.current[mode] = undefined
      channel.setState('saved')
      tidy(settings)
      return 'done'
    } catch {
      if (superseded()) {
        return 'done'
      }
      channel.setState('failed')
      scheduleResend(mode, attempt)
      report()
      return 'hold'
    }
  }

  function scheduleResend(mode: SaveMode, attempt: number) {
    const delay = RESEND_DELAYS_MS[attempt]
    if (delay === undefined) {
      return
    }
    clearTimeout(resendTimer.current)
    resendTimer.current = setTimeout(() => resend(mode, attempt + 1), delay)
  }

  /**
   * Resolves an unknown outcome ahead of anything held behind it: the same save with the same ID,
   * the read a confirmed save still needs, or a save rebuilt after it failed before sending.
   */
  function resend(mode: SaveMode, attempt: number) {
    const pending = unresolved.current[mode]
    if (!pending) {
      return
    }
    void page.queue.run(owners[mode], () => resolving(mode, resolve(mode, pending, attempt)), {
      resolving: true,
    })
  }

  function resolve(mode: SaveMode, pending: Unresolved, attempt: number) {
    switch (pending.kind) {
      case 'send':
        return deliver(mode, pending.save, attempt)
      case 'read':
        return readAfterConfirmed(mode, attempt)
      case 'rebuild':
        unresolved.current[mode] = undefined
        return guarded(mode, pending.scope)
    }
  }

  /** Releases the queue once a resolving save's outcome is known. */
  async function resolving(mode: SaveMode, result: Promise<SaveResult>) {
    const settled = await result
    if (settled === 'done') {
      page.queue.release(owners[mode])
    }
    return settled
  }

  /** Try again: the same request after no answer, or the change over a fresh read after a conflict. */
  function retry(mode: SaveMode) {
    clearTimeout(resendTimer.current)
    const channel = channels[mode]
    if (channel.now() === 'failed') {
      resend(mode, RESEND_DELAYS_MS.length)
      return
    }
    void page.queue.run(
      owners[mode],
      () =>
        resolving(
          mode,
          (async (): Promise<SaveResult> => {
            const current = await channel.reload()
            if (!current) {
              report()
              return 'hold'
            }
            unresolved.current[mode] = undefined
            rebase(current)
            return guarded(mode, mode === 'text' ? textScope.current : EVERY_KEY)
          })(),
        ),
      { resolving: true },
    )
  }

  /**
   * Reload: shows the saved settings and drops the unconfirmed values, every non-text edit for
   * an autosave and the text edit for a Save. Other text drafts stay.
   */
  async function reload(mode: SaveMode) {
    clearTimeout(resendTimer.current)
    recovery.current += 1
    const current = await channels[mode].reload()
    if (!current) {
      report()
      return
    }
    // A text Save's Reload drops only the fields that save sent.
    const pending = unresolved.current[mode]
    const sent = pending?.kind === 'send' ? pending.save.keys : touchedIn(mode)
    for (const key of mode === 'auto' ? touchedIn('auto') : sent) {
      touched.current.delete(key)
      providerEdits.current.delete(key)
    }
    unresolved.current[mode] = undefined
    if (mode === 'auto') {
      page.queue.cancel(owners.auto)
    }
    page.queue.release(owners[mode])
    if (touched.current.size === 0 && !unsettledNow()) {
      settle(current)
    } else {
      rebase(current)
    }
  }

  /**
   * Save: sends the form's text edits within `scope`, once `fields` (every field by default)
   * pass their own validation and the values pass `check`. A draft elsewhere in the form never
   * blocks or joins it.
   */
  function saveText({
    check,
    scope = EVERY_KEY,
    fields,
  }: { check?: (values: V) => boolean; scope?: KeyScope; fields?: Path<V>[] } = {}) {
    if (pendingText.current || text.busy || queue.running || queue.held) {
      return
    }
    pendingText.current = true
    void (async () => {
      const valid = await form.trigger(fields)
      if (!valid || (check && !check(form.getValues()))) {
        return
      }
      textScope.current = scope
      await page.queue.run(owners.text, () => guarded('text', scope))
    })().finally(() => {
      pendingText.current = false
    })
  }

  /**
   * Drops the text edits within `scope` for the loaded settings; what the server saved is left as
   * it is.
   */
  function discardText(scope: KeyScope = EVERY_KEY) {
    if (text.busy) {
      return
    }
    for (const key of touchedIn('text').filter(scope)) {
      touched.current.delete(key)
    }
    unresolved.current.text = undefined
    text.setState('idle')
    page.queue.release(owners.text)
    if (!dirtyNow()) {
      settle(loaded)
    } else {
      rebase(baseRef.current ?? loaded)
    }
  }

  const textDirty = touchedIn('text').length > 0

  return {
    form,
    markEdited,
    /** Keys with an edit awaiting Save, for placing a Save beside the fields it sends. */
    textKeys: touchedIn('text'),
    autosave: {
      state: auto.state,
      revision: loaded.revision,
      retry: () => retry('auto'),
      reload: () => void reload('auto'),
    },
    text: {
      state: text.state,
      busy: text.busy,
      // Another save is running or held: this Save waits; the draft stays editable.
      waiting: (queue.running || queue.held) && !text.busy,
      dirty: textDirty,
      save: saveText,
      retry: () => retry('text'),
      reload: () => void reload('text'),
      discard: discardText,
    },
  }
}
