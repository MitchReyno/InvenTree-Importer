import { useState, type ReactNode } from 'react'
import styled, { css } from 'styled-components'
import { color, radius, ring, size, space, typeVar } from '../../theme/generated/tokens'
import { media } from './media'
import { Skeleton } from './Loading'
import { linkTouchArea } from './primitives'

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
  /** A move handle, drawn on the tile's top-left corner. */
  handle?: ReactNode
  /** Opens the file's note; the tile then shows "＋ Note" or "Edit note". */
  onNote?: () => void
}

function Stage({ preview, name, state }: Pick<EvidenceTileProps, 'preview' | 'name' | 'state'>) {
  // Keyed by URL, so a replacement preview gets its own attempt.
  const [failedPreview, setFailedPreview] = useState<string>()

  if (state === 'preparing') {
    return <Skeleton width="100%" height="100%" />
  }
  if (state === 'failed') {
    return (
      <Placeholder>
        <FailureText>The preview couldn’t be made.</FailureText>
      </Placeholder>
    )
  }
  if (!preview || failedPreview === preview) {
    return (
      <Placeholder>
        <PhotoText aria-hidden="true">▧</PhotoText>
        <PhotoText>{name}</PhotoText>
      </Placeholder>
    )
  }

  return <Image src={preview} alt="" onError={() => setFailedPreview(preview)} />
}

/** One evidence file. No IDs on the tile; the viewer's Details hold them. */
export function EvidenceTile(props: EvidenceTileProps) {
  const { name, support, note, kind, state, selectable, selected = false } = props

  return (
    <Tile $selected={selected}>
      <Preview type="button" aria-label={`Open ${name}`} onClick={props.onOpen}>
        <Stage preview={props.preview} name={name} state={state} />
      </Preview>
      {(props.handle || kind === 'document') && (
        <Corner>
          {props.handle}
          {kind === 'document' && <Tag>Document</Tag>}
        </Corner>
      )}
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
      <Caption data-caption>
        <span title={name}>{name}</span>
        {state === 'preparing' ? (
          <Support>Preparing…</Support>
        ) : (
          support && <Support>{support}</Support>
        )}
      </Caption>
      {state === 'failed' && props.onRetry && (
        <Retry type="button" aria-label={`Retry preview for ${name}`} onClick={props.onRetry}>
          Retry
        </Retry>
      )}
      {(note || props.onNote) && (
        <Note>
          {note}
          {props.onNote && (
            <NoteLink
              type="button"
              aria-label={note ? `Edit note: ${name}` : `Note: ${name}`}
              onClick={props.onNote}
            >
              {note ? 'Edit note' : '＋ Note'}
            </NoteLink>
          )}
        </Note>
      )}
    </Tile>
  )
}

/** Tiles laid out at a 140px minimum. */
export const EvidenceGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: ${space[4]};
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
      outline: ${ring.width} solid ${color.accent};
      outline-offset: ${ring.offset};
    `}
`

const Preview = styled.button`
  display: block;
  padding: 0;
  border: 0;
  aspect-ratio: 4 / 3;
  background: ${color.photoStage};
  cursor: zoom-in;
  position: relative;
  /* Drawn above the image: a photo-fg ring between photo-stage bands reads on any picture. */
  &:focus-visible {
    outline: none;
  }
  &:focus-visible::after {
    content: '';
    position: absolute;
    inset: ${space[2]};
    border: 2px solid ${color.photoFg};
    border-radius: ${radius.sm};
    box-shadow:
      0 0 0 ${ring.width} ${color.photoStage},
      inset 0 0 0 ${ring.width} ${color.photoStage};
    pointer-events: none;
  }
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
  gap: ${space[2]};
  width: 100%;
  height: 100%;
  padding: ${space[4]};
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

const FailureText = styled.span`
  position: relative;
  max-width: 100%;
  font-size: ${typeVar.pill.size};
  line-height: ${typeVar.pill.lineHeight};
  text-align: center;
  overflow-wrap: anywhere;
  color: ${color.photoFg};
`

const overlay = css`
  position: absolute;
  top: ${space[2]};
  border-radius: ${radius.sm};
  background: ${color.photoScrim};
  color: ${color.photoFg};
`

const Corner = styled.span`
  position: absolute;
  top: ${space[2]};
  left: ${space[2]};
  display: flex;
  align-items: flex-start;
  gap: ${space[2]};
  ${media.compact} {
    top: 0;
    left: 0;
  }
`

const Tag = styled.span`
  border-radius: ${radius.sm};
  background: ${color.photoScrim};
  color: ${color.photoFg};
  padding: 1px 5px;
  font-size: 10.5px;
  ${media.compact} {
    margin: ${space[2]};
  }
`

const Tick = styled.label`
  ${overlay}
  right: ${space[2]};
  display: flex;
  /* On the photo scrim the accent ring would vanish; photo-fg keeps focus visible. */
  input:focus-visible {
    outline-color: ${color.photoFg};
  }
  align-items: center;
  justify-content: center;
  padding: 3px 5px;
  cursor: pointer;
  ${media.compact} {
    min-width: ${size.touch};
    min-height: ${size.touch};
    top: 0;
    right: 0;
  }
`

const Caption = styled.span`
  display: flex;
  justify-content: space-between;
  gap: ${space[2]};
  padding: ${space[2]} ${space[3]};
  font-size: ${typeVar.pill.size};
  line-height: ${typeVar.pill.lineHeight};
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
  margin: 0 ${space[3]} ${space[3]};
  padding: 0;
  border: 0;
  background: none;
  color: ${color.accent};
  font-size: 12px;
  text-decoration: underline;
  cursor: pointer;
  ${media.compact} {
    min-width: ${size.touch};
    min-height: ${size.touch};
  }
`

const NoteLink = styled.button`
  margin-left: ${space[2]};
  padding: 0;
  border: 0;
  background: none;
  color: ${color.accent};
  font: inherit;
  cursor: pointer;
  &:hover {
    text-decoration: underline;
  }
  ${linkTouchArea}
`

const Note = styled.p`
  margin: 0;
  padding: 0 ${space[3]} ${space[3]};
  font-size: 12px;
`
