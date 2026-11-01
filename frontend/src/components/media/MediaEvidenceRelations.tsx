import { useForm } from 'react-hook-form'
import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import type {
  CaptureSnapshotDto,
  MediaEditDto,
  MediaEvidenceDto,
  MediaSnapshotDto,
} from '@invimport/contracts'
import { Button, Small } from '../ui/primitives'

interface Props {
  batch: CaptureSnapshotDto
  snapshot: MediaSnapshotDto
  evidence: MediaEvidenceDto
  disabled: boolean
  onDirtyChange: (evidenceId: string, dirty: boolean) => void
  edit: (
    change: MediaEditDto['change'],
    intent?: { key: string; revision: string },
  ) => Promise<void>
}

export function MediaEvidenceRelations({
  batch,
  snapshot,
  evidence,
  disabled,
  edit,
  onDirtyChange,
}: Props) {
  const { register, watch, reset } = useForm<{ groupLabel: string }>({
    defaultValues: { groupLabel: '' },
  })
  const groupLabel = watch('groupLabel')
  const pending = useRef<{ label: string; key: string; revision: string } | null>(null)
  const [unconfirmed, setUnconfirmed] = useState(false)

  useEffect(() => () => onDirtyChange(evidence.id, false), [evidence.id, onDirtyChange])

  async function createGroup() {
    if (!groupLabel.trim()) {
      return
    }
    pending.current ??= {
      label: groupLabel.trim(),
      key: crypto.randomUUID(),
      revision: snapshot.revision,
    }
    setUnconfirmed(true)
    await edit({ kind: 'group', label: pending.current.label }, pending.current)
    pending.current = null
    setUnconfirmed(false)
    reset({ groupLabel: '' })
    onDirtyChange(evidence.id, false)
  }

  return (
    <Relations>
      <label>
        Evidence group
        <select
          disabled={disabled}
          value={evidence.group_id ?? ''}
          onChange={(event) =>
            void edit({
              kind: 'move',
              evidence_id: evidence.id,
              group_id: event.target.value || null,
            }).catch(() => undefined)
          }
        >
          <option value="">Ungrouped</option>
          {snapshot.groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        New group label
        <input
          maxLength={256}
          disabled={disabled || unconfirmed}
          {...register('groupLabel', {
            onChange: (event) => onDirtyChange(evidence.id, Boolean(event.target.value)),
          })}
        />
      </label>
      <Button
        disabled={disabled || !groupLabel.trim()}
        onClick={() => void createGroup().catch(() => undefined)}
      >
        {unconfirmed ? 'Retry exact group request' : 'Create group'}
      </Button>
      {unconfirmed && (
        <Button
          disabled={disabled}
          onClick={() => {
            pending.current = null
            setUnconfirmed(false)
            reset({ groupLabel: '' })
            onDirtyChange(evidence.id, false)
          }}
        >
          Discard unconfirmed local group request
        </Button>
      )}
      <fieldset disabled={disabled}>
        <legend>This evidence supports</legend>
        {[...batch.parts, ...batch.lots].map((subject) => (
          <label key={subject.id}>
            <input
              type="checkbox"
              checked={evidence.linked_subject_ids.includes(subject.id)}
              onChange={(event) =>
                void edit({
                  kind: 'link',
                  evidence_id: evidence.id,
                  subject_id: subject.id,
                  linked: event.target.checked,
                }).catch(() => undefined)
              }
            />
            {subject.label}
          </label>
        ))}
      </fieldset>
      <Small>
        Links retain evidence scope; they do not choose inventory values or change lot identity.
      </Small>
    </Relations>
  )
}

const Relations = styled.div`
  display: grid;
  gap: 10px;
  margin-bottom: 20px;

  label {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  input,
  select {
    max-width: 100%;
  }

  fieldset {
    display: grid;
    gap: 8px;
    border: 1px solid #d5dce5;
  }
`
