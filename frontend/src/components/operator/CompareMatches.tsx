import { useEffect, useState } from 'react'
import styled from 'styled-components'
import type { CaptureEditDto, CaptureSnapshotDto } from '@invimport/contracts'
import { Button, Link, Paragraph, Small } from '../ui/primitives'
import { Modal } from './Modal'

type Part = CaptureSnapshotDto['parts'][number]
type Observation = CaptureSnapshotDto['observations'][number]

interface Props {
  batch: CaptureSnapshotDto
  part: Part
  /** Active lots sharing this Part proposal, including the focused lot. */
  affectedLotIds: string[]
  disabled: boolean
  edit: (change: CaptureEditDto['change']) => Promise<void>
  onClose: () => void
  onDirtyChange?: (dirty: boolean) => void
}

/** Latest observation per existing Part PK; older reads stay retained but are not repeated. */
function partCandidates(batch: CaptureSnapshotDto): Observation[] {
  const byPk = new Map<string, Observation>()
  for (const observation of batch.observations) {
    if (observation.model === 'part') {
      byPk.set(observation.pk, observation)
    }
  }
  return [...byPk.values()]
}

function chosenBy(batch: CaptureSnapshotDto, pk: string) {
  return batch.parts.filter((part) => part.choice.mode === 'set' && part.choice.value.pk === pk)
}

function lotLabels(batch: CaptureSnapshotDto, ids: string[]) {
  return ids.map((id) => batch.lots.find((lot) => lot.id === id)?.label ?? id)
}

/** Existing Part candidates side by side; choosing one is a separate, confirmed shared edit. */
export function CompareMatches({
  batch,
  part,
  affectedLotIds,
  disabled,
  edit,
  onClose,
  onDirtyChange,
}: Props) {
  const [saving, setSaving] = useState(false)
  const [pending, setPending] = useState<Observation | null>(null)
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])
  const candidates = partCandidates(batch)
  const current = part.choice.mode === 'set' ? part.choice.value.pk : null
  const partNotes = batch.notes.filter((note) => note.subject_id === part.id)

  async function confirm(observation: Observation) {
    // A saved revision remounts the dialog; a resolved refusal keeps the local choice.
    setSaving(true)
    try {
      await edit({
        kind: 'part',
        id: part.id,
        choice: {
          mode: 'set',
          value: {
            observation_id: observation.id,
            target_context_id: observation.target_context_id,
            model: 'part',
            pk: observation.pk,
          },
        },
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={`Compare matches · ${part.label}`}
      onClose={onClose}
      closeDisabled={pending !== null || saving}
    >
      <Paragraph>
        Candidates are existing Parts read from the fixed target. ≠ marks a candidate another Part
        proposal in this batch already uses.
      </Paragraph>
      {!candidates.length && (
        <Paragraph>
          No existing Parts have been read for this batch yet.{' '}
          <Link href={`#${batch.id}`}>Read an existing Part in Capture</Link>
        </Paragraph>
      )}
      {candidates.length > 0 && (
        <Scroll role="region" aria-label="Candidate comparison" tabIndex={0}>
          <Table>
            <thead>
              <tr>
                <th scope="col">Field</th>
                <th scope="col">From evidence</th>
                {candidates.map((candidate) => (
                  <th key={candidate.id} scope="col">
                    #{candidate.pk}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Name</th>
                <td>{part.label}</td>
                {candidates.map((candidate) => (
                  <td key={candidate.id}>{candidate.label}</td>
                ))}
              </tr>
              <tr>
                <th scope="row">Read</th>
                <td>—</td>
                {candidates.map((candidate) => (
                  <td key={candidate.id}>{new Date(candidate.observed_at).toLocaleString()}</td>
                ))}
              </tr>
              <tr>
                <th scope="row">Notes · used by</th>
                <td>{partNotes.map((note) => note.text).join(' · ') || 'No Part note'}</td>
                {candidates.map((candidate) => {
                  const others = chosenBy(batch, candidate.pk).filter(
                    (value) => value.id !== part.id,
                  )
                  return (
                    <td key={candidate.id}>
                      {others.length ? `≠ ${others.map((value) => value.label).join(', ')}` : '—'}
                    </td>
                  )
                })}
              </tr>
              <tr>
                <th scope="row">Choice</th>
                <td>{current ? `Currently #${current}` : 'Not chosen'}</td>
                {candidates.map((candidate) => (
                  <td key={candidate.id}>
                    <Button
                      disabled={disabled || saving || candidate.pk === current}
                      onClick={() => {
                        setPending(candidate)
                        onDirtyChange?.(true)
                      }}
                    >
                      Use #{candidate.pk}
                    </Button>
                  </td>
                ))}
              </tr>
            </tbody>
          </Table>
        </Scroll>
      )}
      {pending && (
        <Confirm role="alertdialog" aria-label="Confirm shared Part choice">
          <Paragraph>
            <strong>
              This shared choice affects {affectedLotIds.length} lot
              {affectedLotIds.length === 1 ? '' : 's'}:
            </strong>{' '}
            {lotLabels(batch, affectedLotIds).join(', ')}.
          </Paragraph>
          <Small>Their current reviews will no longer match and must be repeated.</Small>
          <span>
            <Button disabled={disabled || saving} onClick={() => void confirm(pending)}>
              Use #{pending.pk} for {affectedLotIds.length} lot
              {affectedLotIds.length === 1 ? '' : 's'}
            </Button>{' '}
            <Button
              disabled={saving}
              onClick={() => {
                setPending(null)
                onDirtyChange?.(false)
              }}
            >
              Discard Part choice
            </Button>
          </span>
        </Confirm>
      )}
    </Modal>
  )
}

const Scroll = styled.div`
  overflow-x: auto;
  max-width: 100%;
`
const Table = styled.table`
  border-collapse: collapse;
  min-width: 100%;
  th,
  td {
    padding: 8px 10px;
    text-align: left;
    vertical-align: top;
    border-bottom: 1px solid #e3e8ef;
    overflow-wrap: anywhere;
  }
  thead th {
    font-size: 12px;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: #526179;
  }
`
const Confirm = styled.section`
  margin-top: 14px;
  padding: 12px;
  border: 1px solid #e2c47e;
  background: #fffaf0;
  border-radius: 6px;
`
