import { useState } from 'react'
import styled from 'styled-components'
import { color, radius, space, type, typeVar } from '#/theme/generated/tokens'
import type { CaptureSnapshotDto } from '@invimport/contracts'
import { Paragraph, Small, Button, Dialog, localTime } from '#/components/ui'
import { OptionRow } from '#/forms'
import { useReportDirty } from '#/navigation/useReportDirty'
import type { CaptureEdit } from '#/capture/types'

type Part = CaptureSnapshotDto['parts'][number]
type Observation = CaptureSnapshotDto['observations'][number]

interface Props {
  batch: CaptureSnapshotDto
  part: Part
  /** Active lots sharing this Part proposal, including the focused lot. */
  affectedLotIds: string[]
  disabled: boolean
  edit: CaptureEdit
  onClose: () => void
  onDirtyChange?: (dirty: boolean) => void
  /** Opens the shared Part editor in Review, where existing Parts are read. */
  onEditPart?: () => void
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
  onEditPart,
}: Props) {
  const [saving, setSaving] = useState(false)
  const [pending, setPending] = useState<Observation | null>(null)
  useReportDirty(pending !== null, onDirtyChange)
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
    <Dialog
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
          {onEditPart ? (
            <Button
              variant="link"
              type="button"
              onClick={() => {
                onClose()
                onEditPart()
              }}
            >
              Read an existing Part in the shared Part editor
            </Button>
          ) : (
            'Read one in the shared Part editor in Review.'
          )}
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
                  <td key={candidate.id}>{localTime(candidate.observed_at) ?? 'Unknown'}</td>
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
            </tbody>
          </Table>
        </Scroll>
      )}
      {candidates.length > 0 && (
        <ChoiceSet disabled={disabled || saving}>
          <legend>Use a candidate for this shared Part</legend>
          <OptionRow
            name={`match-${part.id}`}
            options={candidates
              .filter((candidate) => candidate.pk !== current)
              .map((candidate) => ({
                id: candidate.id,
                title: `#${candidate.pk}`,
                detail: candidate.label,
              }))}
            escape={{
              id: KEEP,
              title: 'Keep the current choice',
              detail: current ? `#${current}` : 'Not chosen',
            }}
            value={pending?.id ?? KEEP}
            onChange={(id) => {
              const candidate = candidates.find((value) => value.id === id) ?? null
              setPending(candidate)
              onDirtyChange?.(candidate !== null)
            }}
          />
        </ChoiceSet>
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
    </Dialog>
  )
}

const KEEP = 'keep'

const ChoiceSet = styled.fieldset`
  margin: ${space[6]} 0 0;
  padding: 0;
  border: 0;
  legend {
    margin-bottom: ${space[3]};
    font-weight: ${typeVar.bodyStrong.weight};
  }
`
const Scroll = styled.div`
  overflow-x: auto;
  max-width: 100%;
`
const Table = styled.table`
  border-collapse: collapse;
  min-width: 100%;
  th,
  td {
    padding: ${space[4]} ${space[5]};
    text-align: left;
    vertical-align: top;
    border-bottom: 1px solid ${color.line};
    overflow-wrap: anywhere;
  }
  thead th {
    ${type.label}
    color: ${color.muted};
  }
`
const Confirm = styled.section`
  margin-top: ${space[7]};
  padding: ${space[6]};
  border: 1px solid ${color.warn};
  background: ${color.warnWeak};
  border-radius: ${radius.card};
`
