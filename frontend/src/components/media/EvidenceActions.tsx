import styled from 'styled-components'
import { Button, Paragraph } from '../ui/primitives'

type Props = {
  mediaDisabled: boolean
  noteDisabled: boolean
  takePhotos: () => void
  addDocument: () => void
  writeNote?: () => void
  unavailable?: boolean
}

export function EvidenceActions({
  mediaDisabled,
  noteDisabled,
  takePhotos,
  addDocument,
  writeNote,
  unavailable,
}: Props) {
  return (
    <>
      <Actions aria-label="Add evidence">
        <Action type="button" disabled={mediaDisabled} onClick={takePhotos}>
          Take photos
        </Action>
        <Action type="button" disabled={mediaDisabled} onClick={addDocument}>
          Add document
        </Action>
        <Action type="button" disabled={noteDisabled || !writeNote} onClick={writeNote}>
          Write a note
        </Action>
      </Actions>
      {unavailable && (
        <Paragraph role="status">
          Media storage is unavailable. Human notes remain available when Capture is editable.
        </Paragraph>
      )}
    </>
  )
}

const Actions = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 0 0 16px;
  @media (max-width: 430px) {
    grid-template-columns: minmax(0, 1fr);
  }
`
const Action = styled(Button)`
  min-height: 50px;
  background: #266ac5;
  border-color: #1c57a4;
  color: white;
  font-weight: 650;
`
