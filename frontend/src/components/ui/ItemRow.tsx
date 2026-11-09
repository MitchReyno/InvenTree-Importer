import type { ReactNode } from 'react'
import styled from 'styled-components'
import { color, radius, size, space, typeVar } from '#/theme/generated/tokens'
import type { ImageAttributes } from '#/media/images'
import { media } from './media'
import { hoverTransition } from './motion'

type ItemRowProps = {
  /** Keys the state element that describes the row. */
  id: string
  title: string
  meta?: ReactNode
  /** The item's first crop; a glyph stands in without one. */
  thumb?: ImageAttributes
  state?: ReactNode
  /** The row's accessible name, e.g. "Show Packet A". */
  openLabel: string
  current?: boolean
  disabled?: boolean
  /** Sits beside the row, outside its button, e.g. a selection checkbox. */
  leading?: ReactNode
  onOpen: () => void
}

/** The canvas's item row: the whole row opens the item, its state pills as the description. */
export function ItemRow({
  id,
  title,
  meta,
  thumb,
  state,
  openLabel,
  current = false,
  disabled = false,
  leading,
  onOpen,
}: ItemRowProps) {
  const stateId = `${id}-state`
  return (
    <Row $current={current}>
      {leading && <Check>{leading}</Check>}
      <Open
        type="button"
        disabled={disabled}
        aria-label={openLabel}
        aria-describedby={state ? stateId : undefined}
        aria-current={current ? 'true' : undefined}
        onClick={onOpen}
      >
        <Thumb data-thumb aria-hidden="true">
          {thumb ? <img {...thumb} loading="lazy" decoding="async" alt="" /> : <span>▧</span>}
        </Thumb>
        <Body>
          <Title>{title}</Title>
          {meta && <Meta>{meta}</Meta>}
          {state && <State id={stateId}>{state}</State>}
        </Body>
      </Open>
    </Row>
  )
}

const Row = styled.div<{ $current: boolean }>`
  display: flex;
  align-items: stretch;
  gap: ${space[2]};
  margin-top: ${space[2]};
  border: 1px solid ${(p) => (p.$current ? color.accent : 'transparent')};
  border-radius: ${radius.btn};
  background: ${(p) => (p.$current ? color.accentWeak : 'transparent')};
  ${hoverTransition}
  &:hover {
    background: ${(p) => (p.$current ? color.accentWeak : color.surface2)};
  }
`
const Check = styled.label`
  display: flex;
  align-items: center;
  padding-left: ${space[4]};
  cursor: pointer;
  ${media.compact} {
    min-width: ${size.touch};
    justify-content: center;
    padding-left: 0;
  }
`
const Open = styled.button`
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: ${space[5]};
  flex: 1;
  min-width: 0;
  padding: 7px ${space[4]};
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  &:disabled {
    cursor: default;
  }
`
const Thumb = styled.span`
  display: grid;
  place-items: center;
  /* literal-allowed: the canvas's square row thumbnail; no thumbnail size token */
  width: 48px;
  height: 48px;
  overflow: hidden;
  border: 1px solid ${color.line};
  border-radius: ${radius.thumb};
  background: ${color.photoStage};
  color: ${color.photoFg};
  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`
const Body = styled.span`
  display: grid;
  gap: ${space[1]};
  min-width: 0;
`
const Title = styled.strong`
  overflow: hidden;
  font-size: ${typeVar.bodyStrong.size};
  font-weight: ${typeVar.bodyStrong.weight};
  text-overflow: ellipsis;
  white-space: nowrap;
`
const State = styled.span`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[2]};
  /* A long state wraps inside the narrow queue rather than overflowing it. */
  [data-tone] {
    max-width: 100%;
    white-space: normal;
  }
`
const Meta = styled.span`
  color: ${color.muted};
  font-size: ${typeVar.small.size};
`
