import styled from 'styled-components'
import type { CaptureSnapshotDto, ManualWorkspaceDto } from '@invimport/contracts'
import { Button, Heading, Panel, Small } from '../ui/primitives'
import { display } from '../../capture/display'

interface Props {
  batch: CaptureSnapshotDto
  workspace: ManualWorkspaceDto
  selected: string[]
  focused: string | null
  busy: boolean
  toggle: (id: string) => void
  inspect: (id: string) => void
}
export function ReviewQueue({ batch, workspace, selected, focused, busy, toggle, inspect }: Props) {
  return (
    <Panel aria-label="Physical lot review queue">
      <Heading>Physical lots</Heading>
      <Small>
        Select up to 10 original contributions. Sharing a Part never includes another lot.
      </Small>
      {batch.lots.map((lot) => {
        const status = workspace.lots.find((value) => value.lot_id === lot.id)
        const approved = status?.issues.some(
          (value) => value.code === 'original_contribution_already_approved',
        )
        return (
          <QueueRow key={lot.id} $focused={focused === lot.id}>
            <CheckLabel>
              <input
                type="checkbox"
                aria-label={`Select ${lot.label}`}
                checked={selected.includes(lot.id)}
                disabled={
                  busy ||
                  batch.archived ||
                  approved ||
                  (!selected.includes(lot.id) && selected.length >= 10)
                }
                onChange={() => toggle(lot.id)}
              />
              <strong>{lot.label}</strong>
            </CheckLabel>
            <Small>{display(lot.quantity, batch, 'quantity')}</Small>
            <Small>
              {approved
                ? 'Original approval retained'
                : status?.reviewed
                  ? 'Reviewed exact saved values'
                  : 'Needs review'}
            </Small>
            <Button disabled={busy} onClick={() => inspect(lot.id)}>
              Inspect {lot.label}
            </Button>
          </QueueRow>
        )
      })}
    </Panel>
  )
}
const QueueRow = styled.div<{ $focused: boolean }>`
  padding: 12px;
  margin-top: 10px;
  border: 1px solid ${(p) => (p.$focused ? '#266ac5' : '#d5dce5')};
  border-left-width: ${(p) => (p.$focused ? '4px' : '1px')};
  border-radius: 5px;
  background: ${(p) => (p.$focused ? '#e0eafa' : '#f7f9fc')};
  button {
    margin-top: 9px;
    width: 100%;
    text-align: left;
  }
`
const CheckLabel = styled.label`
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  input {
    width: 20px;
    height: 20px;
    flex-shrink: 0;
  }
`
