import { useId } from 'react'
import styled from 'styled-components'
import { color, icon, opacity, radius, space, type, typeVar } from '#/theme/generated/tokens'
import { media, hoverTransition, Banner } from '#/components/ui'

type Props = {
  mediaDisabled: boolean
  noteDisabled: boolean
  takePhotos: () => void
  addDocument: () => void
  writeNote?: () => void
  unavailable?: boolean
}

export function CaptureActions({
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
        <CaptureTile
          glyph="◉"
          label="Take photos"
          subline="Camera or library"
          disabled={mediaDisabled}
          onClick={takePhotos}
        />
        <CaptureTile
          glyph="▤"
          label="Add document"
          subline="Receipt, invoice, PDF"
          disabled={mediaDisabled}
          onClick={addDocument}
        />
        <CaptureTile
          glyph="✎"
          label="Write a note"
          subline="Or paste text"
          disabled={noteDisabled || !writeNote}
          onClick={writeNote}
        />
      </Actions>
      {unavailable && (
        <div role="status">
          <Banner tone="warn">
            Media storage is unavailable. Human notes remain available when Capture is editable.
          </Banner>
        </div>
      )}
    </>
  )
}

type TileProps = {
  glyph: string
  label: string
  subline: string
  disabled: boolean
  onClick?: () => void
}

// The subline describes the tile, so the button's name stays the action alone.
function CaptureTile({ glyph, label, subline, disabled, onClick }: TileProps) {
  const id = useId()

  return (
    <Tile
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-labelledby={`${id}-label`}
      aria-describedby={`${id}-subline`}
    >
      <TileGlyph aria-hidden="true">{glyph}</TileGlyph>
      <span id={`${id}-label`}>{label}</span>
      <TileSubline id={`${id}-subline`}>{subline}</TileSubline>
    </Tile>
  )
}

const Actions = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: ${space[4]};
`
const Tile = styled.button`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${space[2]};
  padding: ${space[7]} ${space[4]};
  border: 1px solid ${color.lineStrong};
  border-radius: ${radius.card};
  background: ${color.surface};
  color: ${color.fg};
  font: inherit;
  font-weight: ${typeVar.bodyStrong.weight};
  text-align: center;
  overflow-wrap: anywhere;
  cursor: pointer;
  touch-action: manipulation;
  ${hoverTransition}
  &:hover:not(:disabled) {
    background: ${color.surface2};
  }
  &:disabled {
    opacity: ${opacity.disabled};
    cursor: not-allowed;
  }
  ${media.compact} {
    min-height: 88px;
  }
`
const TileGlyph = styled.span`
  color: ${color.accent};
  font-size: ${icon.md};
  line-height: 1;
`
const TileSubline = styled.small`
  ${type.small}
  color: ${color.muted};
`
