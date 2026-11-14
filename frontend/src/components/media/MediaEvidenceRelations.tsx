import styled from 'styled-components'
import { color, size, space } from '#/theme/generated/tokens'
import { media, Small } from '#/components/ui'
import type { EditMedia } from '#/media/types'
import type { CaptureSnapshotDto, MediaEvidenceDto } from '@invimport/contracts'

interface Props {
  batch: CaptureSnapshotDto
  evidence: MediaEvidenceDto
  disabled: boolean
  edit: EditMedia
}

export function MediaEvidenceRelations({ batch, evidence, disabled, edit }: Props) {
  return (
    <Relations>
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
                })
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
  gap: ${space[5]};
  margin-bottom: ${space[10]};

  label {
    display: flex;
    align-items: center;
    gap: ${space[4]};
    flex-wrap: wrap;
    ${media.compact} {
      min-height: ${size.touch};
    }
  }

  input,
  select {
    max-width: 100%;
  }

  fieldset {
    display: grid;
    gap: ${space[4]};
    border: 1px solid ${color.line};
  }
`
