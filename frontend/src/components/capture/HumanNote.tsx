import { ActionsMenu, Paragraph, Small, Summary } from '#/components/ui'
import type { Snapshot } from '#/capture/types'
import styled from 'styled-components'
import { color, space, typeVar } from '#/theme/generated/tokens'

const NOTE_DELETE_LATER =
  'Deleting written notes comes later. A file’s note can be cleared by saving it empty.'

export function HumanNote({ note, batch }: { note: Snapshot['notes'][number]; batch: Snapshot }) {
  const subject = [...batch.lots, ...batch.parts].find((s) => s.id === note.subject_id)
  return (
    <NoteCard>
      <Heading>
        <strong>Human · {subject?.label ?? 'Batch'}</strong>
        <ActionsMenu
          label="Actions for note"
          items={[
            { label: 'Delete…', onSelect: () => undefined, disabledReason: NOTE_DELETE_LATER },
          ]}
        />
      </Heading>
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

const Heading = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${space[4]};
`

const NoteCard = styled.article`
  border-top: 1px solid ${color.line};
  padding: ${space[7]} 0 ${space[2]};
  font-size: ${typeVar.body.size};
  p {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
`
