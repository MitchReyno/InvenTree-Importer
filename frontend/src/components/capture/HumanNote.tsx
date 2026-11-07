import { Paragraph, Small, Summary } from '../ui/primitives'
import type { Snapshot } from '../../capture/types'
import styled from 'styled-components'
import { color } from '../../theme/generated/tokens'

export function HumanNote({ note, batch }: { note: Snapshot['notes'][number]; batch: Snapshot }) {
  const subject = [...batch.lots, ...batch.parts].find((s) => s.id === note.subject_id)
  return (
    <NoteCard>
      <strong>Human · {subject?.label ?? 'Batch'}</strong>
      <Paragraph>{note.text || '(Empty original note)'}</Paragraph>
      <Small>{new Date(note.created_at).toLocaleString()}</Small>
      <details>
        <Summary>Note attribution</Summary>
        <Small>
          Actor {note.actor_id}
          <br />
          Note {note.id}
        </Small>
      </details>
    </NoteCard>
  )
}

const NoteCard = styled.article`
  border-top: 1px solid ${color.line};
  padding: 14px 0 4px;
  font-size: 14px;
  p {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
`
