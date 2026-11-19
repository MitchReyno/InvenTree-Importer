import { useEffect, useRef, useState } from 'react'
import { IntakeRequestError } from '@invimport/contracts/client'
import type { BatchDefaultRecordDto, BatchDefaultsDto } from '@invimport/contracts'
import { SettingRow, Small } from '#/components/ui'
import type { BatchDefaultsClient } from '#/catalogue/types'
import { useMountedRef } from '#/lifecycle/useMountedRef'
import { SaveBar } from './agents/SaveBar'
import type { SaveState } from './agents/useSettingsSave'
import { Stack } from './agents/Stack'
import { SettingsCard } from './SettingsCard'
import { BatchDefaultRow } from './BatchDefaultRow'

export type Draft = {
  location: BatchDefaultRecordDto | null
  supplier: BatchDefaultRecordDto | null
}

const draftOf = (saved: BatchDefaultsDto): Draft => ({
  location: saved.location,
  supplier: saved.supplier,
})

/** Refusals of a newly chosen record, beyond SaveBar's conflict and failure. */
const REFUSED = {
  missing: "That record isn't in InvenTree any more. Choose another and save again.",
  unchecked: "InvenTree couldn't be checked, so nothing was saved. Try again.",
}

/** The default location and supplier, picked from InvenTree and saved under one revision. */
export function BatchDefaultsForm({
  client,
  loaded,
  onLoaded,
  onDirtyChange,
}: {
  client: BatchDefaultsClient
  loaded: BatchDefaultsDto
  /** Publishes confirmed defaults and answers with the newest known. */
  onLoaded: (saved: BatchDefaultsDto) => BatchDefaultsDto
  onDirtyChange: (dirty: boolean) => void
}) {
  const mounted = useMountedRef()
  const report = useRef(onDirtyChange)
  useEffect(() => {
    report.current = onDirtyChange
  }, [onDirtyChange])
  // Leaving drops the choice, so the guard is released with it.
  useEffect(() => () => report.current(false), [])
  // An edit holds the defaults it was made over with its choices, so values and revision match.
  // Until the first edit the form shows the latest load.
  const [edit, setEdit] = useState<{ base: BatchDefaultsDto; draft: Draft } | null>(null)
  const draft = edit?.draft ?? draftOf(loaded)
  const [state, setState] = useState<SaveState | 'missing' | 'unchecked'>('idle')
  const busy = state === 'saving' || state === 'reloading'

  function choose(field: keyof Draft, record: BatchDefaultRecordDto | null) {
    if (busy) {
      return
    }
    const start = edit?.base ?? loaded
    const next = { ...(edit?.draft ?? draftOf(loaded)), [field]: record }
    // An unconfirmed save or a conflict stays reported, with Reload, until a Reload settles it.
    const unsettled = state === 'failed' || state === 'conflict' || state === 'reloadFailed'
    if (!unsettled) {
      setState('idle')
    }
    // A choice undone back to the saved records is no longer unsaved, unless what is saved is
    // still unknown.
    if (
      !unsettled &&
      next.location?.pk === start.location?.pk &&
      next.supplier?.pk === start.supplier?.pk
    ) {
      setEdit(null)
      onDirtyChange(false)
      return
    }
    setEdit({ base: start, draft: next })
    onDirtyChange(true)
  }

  function adopt(saved: BatchDefaultsDto) {
    // The form shows the newest load once the edit is settled.
    onLoaded(saved)
    setEdit(null)
    onDirtyChange(false)
  }

  async function save() {
    // SaveBar also blocks a Save while what is saved is unknown or contested.
    if (busy || state === 'failed' || state === 'conflict' || state === 'reloadFailed') {
      return
    }
    setState('saving')
    try {
      const saved = await client.save({
        // The revision this choice was made over, so a newer save elsewhere is a conflict.
        expected_revision: (edit?.base ?? loaded).revision,
        location_pk: draft.location?.pk ?? null,
        supplier_pk: draft.supplier?.pk ?? null,
      })
      if (mounted.current) {
        adopt(saved)
        setState('saved')
      }
    } catch (caught) {
      if (!mounted.current) {
        return
      }
      const code = caught instanceof IntakeRequestError ? caught.code : undefined
      if (code === 'revision_conflict') {
        setState('conflict')
      } else if (code === 'batch_default_not_found') {
        setState('missing')
      } else if (code === 'catalogue_unavailable') {
        setState('unchecked')
      } else {
        setState('failed')
      }
    }
  }

  /** Drops the choice for the loaded defaults; what the server saved is left as it is. */
  function discard() {
    if (!busy) {
      setEdit(null)
      setState('idle')
      onDirtyChange(false)
    }
  }

  async function reload() {
    setState('reloading')
    try {
      const current = await client.read()
      if (mounted.current) {
        adopt(current)
        setState('idle')
      }
    } catch {
      if (mounted.current) {
        // Reload stays offered: the choice is kept and what is saved is still unknown.
        setState('reloadFailed')
      }
    }
  }

  return (
    <SettingsCard aria-label="Batch defaults">
      <BatchDefaultRow
        field="location"
        model="location"
        label="Default location"
        help="Where new stock goes unless a lot says otherwise. An existing InvenTree location."
        clearLabel="No default location"
        value={draft.location}
        busy={busy}
        onChoose={choose}
      />
      <BatchDefaultRow
        field="supplier"
        model="supplier"
        label="Default supplier"
        help="Leave empty for salvage and bench batches. An existing InvenTree company."
        clearLabel="No supplier"
        value={draft.supplier}
        busy={busy}
        onChoose={choose}
      />
      <SettingRow label="Save defaults">
        <Stack>
          <SaveBar
            state={state === 'missing' || state === 'unchecked' ? 'idle' : state}
            busy={busy}
            savedMessage="Saved. Batches created from now on start with these."
            onSave={() => void save()}
            onReload={() => void reload()}
            onDiscard={discard}
            dirty={edit !== null}
          />
          {(state === 'missing' || state === 'unchecked') && (
            <Small role="alert">{REFUSED[state]}</Small>
          )}
        </Stack>
      </SettingRow>
    </SettingsCard>
  )
}
