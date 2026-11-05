import styled, { css } from 'styled-components'
import { color, radius, space } from '../../theme/generated/tokens'
import { Skeleton } from './Progress'

export type EvidenceKind = 'photo' | 'document'
export type PreviewState = 'ready' | 'preparing' | 'failed'

type EvidenceTileProps = {
  /** Preview image URL; without one the tile shows the file name on the photo stage. */
  preview?: string
  name: string
  /** What the file supports, such as "1 lot". */
  support?: string
  note?: string
  kind: EvidenceKind
  state: PreviewState
  selectable?: boolean
  selected?: boolean
  onOpen: () => void
  onSelect?: (selected: boolean) => void
  onRetry?: () => void
}

function Stage({ preview, name, state }: Pick<EvidenceTileProps, 'preview' | 'name' | 'state'>) {
  if (state === 'preparing') {
    return (
      <Placeholder>
        <Skeleton width="100%" height="100%" />
        <PhotoText>Preparing…</PhotoText>
      </Placeholder>
    )
  }
  if (state === 'failed') {
    return (
      <Placeholder>
        <PhotoText>The preview couldn’t be made.</PhotoText>
      </Placeholder>
    )
  }
  if (!preview) {
    return (
      <Placeholder>
        <PhotoText aria-hidden="true">▧</PhotoText>
        <PhotoText>{name}</PhotoText>
      </Placeholder>
    )
  }

  return <Image src={preview} alt="" />
}

/** One evidence file. No IDs on the tile; the viewer's Details hold them. */
export function EvidenceTile(props: EvidenceTileProps) {
  const { name, support, note, kind, state, selectable, selected = false } = props

  return (
    <Tile $selected={selected}>
      <Preview type="button" aria-label={`Open ${name}`} onClick={props.onOpen}>
        <Stage preview={props.preview} name={name} state={state} />
      </Preview>
      {kind === 'document' && <Tag>Document</Tag>}
      {selectable && (
        <Tick>
          <input
            type="checkbox"
            aria-label={`Select ${name}`}
            checked={selected}
            onChange={(event) => props.onSelect?.(event.target.checked)}
          />
        </Tick>
      )}
      <Caption>
        <span title={name}>{name}</span>
        {support && <Support>{support}</Support>}
      </Caption>
      {state === 'failed' && props.onRetry && (
        <Retry type="button" aria-label={`Retry preview for ${name}`} onClick={props.onRetry}>
          Retry
        </Retry>
      )}
      {note && <Note>{note}</Note>}
    </Tile>
  )
}

/** Tiles laid out at a 140px minimum. */
export const EvidenceGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: ${space[2]};
`

const Tile = styled.div<{ $selected: boolean }>`
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid ${color.line};
  border-radius: ${radius.input};
  background: ${color.surface};
  ${({ $selected }) =>
    $selected &&
    css`
      outline: 2px solid ${color.accent};
      outline-offset: 1px;
    `}
`

const Preview = styled.button`
  display: block;
  padding: 0;
  border: 0;
  aspect-ratio: 4 / 3;
  background: ${color.photoStage};
  cursor: zoom-in;
`

const Image = styled.img`
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
`

const Placeholder = styled.span`
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: ${space[1]};
  width: 100%;
  height: 100%;
  padding: ${space[2]};
  & > span:first-child[aria-hidden='true']:not(:only-child) {
    position: absolute;
    inset: 0;
  }
`

const PhotoText = styled.span`
  position: relative;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11.5px;
  color: ${color.photoFg};
`

const overlay = css`
  position: absolute;
  top: ${space[1]};
  border-radius: ${radius.sm};
  background: ${color.photoScrim};
  color: ${color.photoFg};
`

const Tag = styled.span`
  ${overlay}
  left: ${space[1]};
  padding: 1px 5px;
  font-size: 10.5px;
`

const Tick = styled.span`
  ${overlay}
  right: ${space[1]};
  display: flex;
  padding: 3px 5px;
`

const Caption = styled.span`
  display: flex;
  justify-content: space-between;
  gap: ${space[1]};
  padding: ${space[1]} ${space['1-5']};
  font-size: 11.5px;
  span:first-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`

const Support = styled.span`
  flex: none;
  color: ${color.muted};
`

const Retry = styled.button`
  align-self: flex-start;
  margin: 0 ${space['1-5']} ${space['1-5']};
  padding: 0;
  border: 0;
  background: none;
  color: ${color.accent};
  font-size: 12px;
  text-decoration: underline;
  cursor: pointer;
`

const Note = styled.p`
  margin: 0;
  padding: 0 ${space['1-5']} ${space['1-5']};
  font-size: 12px;
`
