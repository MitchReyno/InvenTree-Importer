import { useState } from 'react'
import type { CaptureSnapshotDto } from '@invimport/contracts'
import { Button } from '#/components/ui'
import { ChoicePicker } from '#/forms'
import type { CaptureEdit } from '#/capture/types'

interface Props {
  batch: CaptureSnapshotDto
  observationId: string
  /** The observation's current lot, if it is in a live one. */
  lotId: string | null
  name: string
  edit?: CaptureEdit
  disabled: boolean
}

/** The operator's own move of one observation to another lot, or out of any lot. */
export function ObservationMove({ batch, observationId, lotId, name, edit, disabled }: Props) {
  const targets = batch.lots.filter((lot) => !lot.retired && lot.id !== lotId)
  const [target, setTarget] = useState('')
  if (!targets.length && lotId === null) {
    return null
  }
  return (
    <span>
      <ChoicePicker
        label={`Move ${name} to`}
        clearable
        noun="lots"
        placeholder="Choose a lot…"
        choices={[
          ...targets.map((lot) => ({ value: lot.id, label: lot.label })),
          ...(lotId !== null ? [{ value: 'none', label: 'No lot' }] : []),
        ]}
        value={target}
        disabled={disabled || !edit}
        onChange={setTarget}
      />{' '}
      <Button
        type="button"
        disabled={disabled || !edit || !target}
        onClick={() =>
          void edit?.({
            kind: 'observation_move',
            observation_id: observationId,
            lot_id: target === 'none' ? null : target,
          })
        }
      >
        Move
      </Button>
    </span>
  )
}
