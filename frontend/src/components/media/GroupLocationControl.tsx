import { useState } from 'react'
import type { CaptureAssignedLocationChangeDto, CaptureSnapshotDto } from '@invimport/contracts'
import type { CaptureWorkspaceProps } from '../../capture/types'
import { AssignedLocationField } from '../capture/AssignedLocationField'
import { Button, Small } from '../ui/primitives'

interface Props {
  batch: CaptureSnapshotDto
  groupId: string
  name: string
  disabled: boolean
  edit: CaptureWorkspaceProps['edit']
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
  onDirtyChange,
}: Props) {
  const [draft, setDraft] = useState<CaptureAssignedLocationChangeDto | null>(null)
  const [state, setState] = useState<'idle' | 'saving' | 'failed'>('idle')
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

  function discard() {
    setDraft(null)
    setState('idle')
    onDirtyChange(false)
  }

  const shown = draft ? (draft.mode === 'unset' ? undefined : draft) : saved
  return (
    <>
      <AssignedLocationField
        label={`Location for group ${name}`}
        scope="Applies to lots linked to this group's evidence when they use the batch default and their shared Part has no location. Different group locations for one lot must be resolved in Review."
        value={shown}
        batch={batch}
        disabled={disabled || state !== 'idle'}
        onChange={(location) => void save(location)}
      />
      {state === 'saving' && <Small role="status">Saving the group location…</Small>}
      {state === 'failed' && draft && (
        <>
          <Small role="alert">
            The group location was not confirmed. Retry the same change or discard it.
          </Small>
          <Button type="button" disabled={disabled} onClick={() => void save(draft)}>
            Retry group location
          </Button>
          <Button type="button" onClick={discard}>
            Discard group location change
          </Button>
        </>
      )}
    </>
  )
}
