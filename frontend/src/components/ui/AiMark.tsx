import type { ReactNode } from 'react'
import styled from 'styled-components'
import { color, space } from '#/theme/generated/tokens'
import { AiSparkleIcon } from './icons'

export type AiMarkSize = 'sm' | 'md' | 'lg'

// Tile and icon edge in px: `sm` in chips and field labels, `md` beside headings, `lg` page titles.
const TILE = {
  sm: { tile: 18, icon: 12, radius: 5 },
  md: { tile: 20, icon: 14, radius: 6 },
  lg: { tile: 26, icon: 18, radius: 7 },
} as const

type AiMarkProps = {
  size?: AiMarkSize
  /** The label that names the agent; the mark is centred on it. */
  children?: ReactNode
}

/**
 * The AI sparkle on its tile, marking where a person meets an agent. It is decorative: the label
 * beside it names the agent. With a label it owns the centred flex row, so the tile sits on the
 * text's centre line rather than relying on `vertical-align`.
 */
export function AiMark({ size = 'md', children }: AiMarkProps) {
  const tile = (
    <Tile aria-hidden="true" data-ai-mark="" data-size={size} $size={size}>
      <AiSparkleIcon />
    </Tile>
  )

  if (children === undefined) {
    return tile
  }

  return (
    <Labelled>
      {tile}
      {children}
    </Labelled>
  )
}

const Labelled = styled.span`
  display: inline-flex;
  align-items: center;
  gap: ${space[3]};
`

const Tile = styled.span<{ $size: AiMarkSize }>`
  display: inline-grid;
  flex: none;
  place-items: center;
  width: ${({ $size }) => TILE[$size].tile}px;
  height: ${({ $size }) => TILE[$size].tile}px;
  border-radius: ${({ $size }) => TILE[$size].radius}px;
  background: ${color.aiWeak};
  color: ${color.ai};
  svg {
    display: block;
    width: ${({ $size }) => TILE[$size].icon}px;
    height: ${({ $size }) => TILE[$size].icon}px;
  }
`
