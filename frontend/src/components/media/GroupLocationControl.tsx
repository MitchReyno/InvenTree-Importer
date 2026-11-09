import { useState } from 'react'
import type { CaptureAssignedLocationChangeDto, CaptureSnapshotDto } from '@invimport/contracts'
import { AssignedLocationField } from '#/components/capture/AssignedLocationField'
import { Small, Button } from '#/components/ui'
import type { CaptureEdit } from '#/capture/types'
import { useMountedRef } from '#/lifecycle/useMountedRef'

interface Props {
  batch: CaptureSnapshotDto
  groupId: string
  name: string
  disabled: boolean
  edit: CaptureEdit
  /** The owner's explicit discard: reloads saved values and clears its retained command. */
  reload?: () => Promise<void>
  onDirtyChange: (dirty: boolean) => void
}

/**
 * Owns one group's location draft: the chosen value stays visible and dirty until the capture
 * command is acknowledged, and a refused or unconfirmed save offers the exact retry or discard.
 */
export function GroupLocationControl({
  batch,
  groupId,
  name,
  disabled,
  edit,
  reload,
  onDirtyChange,
}: Props) {
  const [draft, setDraft] = useState<CaptureAssignedLocationChangeDto | null>(null)
  const [state, setState] = useState<'idle' | 'saving' | 'failed' | 'discarding'>('idle')
  const [reloadFailed, setReloadFailed] = useState(false)
  const mounted = useMountedRef()
  const saved = batch.group_locations?.find((item) => item.group_id === groupId)?.location

  async function save(location: CaptureAssignedLocationChangeDto) {
    setDraft(location)
    setState('saving')
    onDirtyChange(true)
    const result = await edit({ kind: 'group_location', group_id: groupId, location })
    if (result === false) {
      setState('failed')
      return
    }
    setDraft(null)
    setState('idle')
    onDirtyChange(false)
  }

  /**
   * The unconfirmed command is retained by the batch owner, so discard reloads saved values there.
   * Success remounts Capture; while this control is still mounted the reload failed, so the draft
   * and its protection stay.
   */
  async function discard() {
    if (!reload) {
      return
    }
    setState('discarding')
    setReloadFailed(false)
    await reload()
    if (mounted.current) {
      setState('failed')
      setReloadFailed(true)
    }
  }

  const shown = draft ? (draft.mode === 'unset' ? undefined : draft) : saved
  return (
    <>
      <AssignedLocationField
        label={`Location for group ${name}`}
        scope="Applies to lots linked to this group's evidence when they use the batch default and their shared Part has no location. Different group locations for one lot must be resolved in Review."
        value={shown}
        batch={batch}
        inline
        disabled={disabled || state !== 'idle'}
        onChange={(location) => void save(location)}
      />
      {state === 'saving' && <Small role="status">Saving the group location…</Small>}
      {state === 'discarding' && <Small role="status">Reloading saved values…</Small>}
      {reloadFailed && (
        <Small role="alert">Saved values could not be reloaded; the change is kept.</Small>
      )}
      {state === 'failed' && draft && (
        <>
          <Small role="alert">
            The group location was not confirmed. Retry the same change or discard it.
          </Small>
          <Button type="button" disabled={disabled} onClick={() => void save(draft)}>
            Retry group location
          </Button>
          {reload && (
            <Button type="button" onClick={() => void discard()}>
              Discard group location change
            </Button>
          )}
        </>
      )}
    </>
  )
}
