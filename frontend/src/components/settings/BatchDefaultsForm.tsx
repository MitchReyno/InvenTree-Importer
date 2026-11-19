import { useState } from 'react'
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
  onLoaded: (saved: BatchDefaultsDto) => void
  onDirtyChange: (dirty: boolean) => void
}) {
  const mounted = useMountedRef()
  const [draft, setDraft] = useState<Draft>(() => draftOf(loaded))
  const [state, setState] = useState<SaveState | 'missing' | 'unchecked'>('idle')
  const busy = state === 'saving' || state === 'reloading'

  function choose(field: keyof Draft, record: BatchDefaultRecordDto | null) {
    setDraft((current) => ({ ...current, [field]: record }))
    setState('idle')
    onDirtyChange(true)
  }

  function adopt(saved: BatchDefaultsDto) {
    onLoaded(saved)
    setDraft(draftOf(saved))
    onDirtyChange(false)
  }

  async function save() {
    if (busy) {
      return
    }
    setState('saving')
    try {
      const saved = await client.save({
        expected_revision: loaded.revision,
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
        setState('failed')
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
          />
          {(state === 'missing' || state === 'unchecked') && (
            <Small role="alert">{REFUSED[state]}</Small>
          )}
        </Stack>
      </SettingRow>
    </SettingsCard>
  )
}
