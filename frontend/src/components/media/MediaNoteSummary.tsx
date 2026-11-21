import type { MediaSnapshotDto } from '@invimport/contracts'
import styled from 'styled-components'
import { DebugDetails, Small, localTime } from '#/components/ui'

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
      {saved && <Small>Saved {saved}</Small>}
      <DebugDetails
        label="Note provenance"
        rows={[
          { label: 'Version', value: note.version },
          { label: 'Record', value: note.id },
          { label: 'Actor', value: note.actor_id },
        ]}
      />
    </div>
  )
}

const Text = styled.p`
  white-space: pre-wrap;
  overflow-wrap: anywhere;
`
