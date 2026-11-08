import type { MediaSnapshotDto } from '@invimport/contracts'
import styled from 'styled-components'
import { Small, Summary } from '../ui/primitives'
import { localTime } from '../ui/RelativeTime'

type Props = { title: string; note: MediaSnapshotDto['evidence'][number]['note'] }

export function MediaNoteSummary({ title, note }: Props) {
  if (!note) {
    return <Small>{title}: no human note saved.</Small>
  }
  const saved = localTime(note.created_at)
  return (
    <div>
      <strong>{title} · Human context</strong>
      <Text>{note.text || 'Empty human note.'}</Text>
      <Small>
        Version {note.version}
        {saved && ` · ${saved}`}
      </Small>
      <details>
        <Summary>Note provenance</Summary>
        <Small>
          Record {note.id} · actor {note.actor_id}
        </Small>
      </details>
    </div>
  )
}

const Text = styled.p`
  white-space: pre-wrap;
  overflow-wrap: anywhere;
`
