import type { MediaSnapshotDto } from '@invimport/contracts'
import styled from 'styled-components'
import { Small } from '../ui/primitives'

type Props = { title: string; note: MediaSnapshotDto['evidence'][number]['note'] }

export function MediaNoteSummary({ title, note }: Props) {
  if (!note) {
    return <Small>{title}: no human note saved.</Small>
  }
  return (
    <div>
      <strong>{title} · Human context</strong>
      <Text>{note.text || 'Empty human note.'}</Text>
      <Small>
        Version {note.version} · {new Date(note.created_at).toLocaleString()}
      </Small>
      <details>
        <summary>Note provenance</summary>
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
