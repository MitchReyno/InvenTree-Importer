import { useId } from 'react'
import styled from 'styled-components'
import { space } from '#/theme/generated/tokens'
import type { CaptureSnapshotDto, MediaEditDto, MediaSnapshotDto } from '@invimport/contracts'
import { mediaIdentityLabels } from '#/media/identity-labels'
import { Label, Select, Small } from '#/components/ui'

type Props = {
  batch: CaptureSnapshotDto
  subjectId: string
  snapshot: MediaSnapshotDto
  disabled: boolean
  edit: (change: MediaEditDto['change']) => Promise<unknown>
}

/** Chooses the retained version attached to one physical lot or shared Part. */
export function SubjectAttachmentChoice({ batch, subjectId, snapshot, disabled, edit }: Props) {
  const id = useId()
  const part = batch.parts.find((item) => item.id === subjectId)
  const subject = batch.lots.find((item) => item.id === subjectId) ?? part
  if (!subject) {
    return null
  }
  const noun = part ? 'Part' : 'lot'
  const destination = part ? ('part_attachment' as const) : ('lot_attachment' as const)
  const selection = snapshot.attachments.find((item) => item.subject_id === subjectId)
  const labels = mediaIdentityLabels(snapshot.evidence)
  let description = 'Not chosen'
  if (selection?.version_id) {
    description =
      labels.versions.get(selection.version_id) ?? `Saved version ${selection.version_id}`
  } else if (selection?.mode === 'declined') {
    description = `No attachment for this ${noun}`
  }
  return (
    <Choice>
      <Label htmlFor={id}>Attachment for {subject.label}</Label>
      <Select
        id={id}
        aria-describedby={`${id}-selection`}
        disabled={disabled}
        value={selection?.version_id ?? selection?.mode ?? 'unset'}
        onChange={(event) => {
          const value = event.target.value
          const mode = value === 'unset' || value === 'declined' ? value : 'selected'
          void edit({
            kind: 'select_attachment',
            subject_id: subject.id,
            mode,
            version_id: mode === 'selected' ? value : null,
            destination,
          }).catch(() => undefined)
        }}
      >
        <option value="unset">Not chosen</option>
        <option value="declined">No attachment for this {noun}</option>
        {snapshot.evidence.flatMap((evidence) =>
          evidence.versions
            .filter((version) => version.state === 'ready')
            .map((version) => (
              <option key={version.id} value={version.id}>
                {labels.versions.get(version.id)}
              </option>
            )),
        )}
      </Select>
      <Small id={`${id}-selection`}>Selected attachment: {description}</Small>
    </Choice>
  )
}

const Choice = styled.div`
  display: grid;
  gap: ${space[3]};
  width: 100%;
  min-width: 0;
  max-width: 100%;
  label {
    min-width: 0;
    max-width: 100%;
    overflow-wrap: anywhere;
  }
  select {
    max-width: 100%;
  }
`
