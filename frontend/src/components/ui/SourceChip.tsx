import styled, { css } from 'styled-components'
import { color, radius, space } from '../../theme/generated/tokens'
import { linkTouchArea } from './primitives'
import { hoverTransition } from './motion'

export type SourceTone = 'default' | 'likely' | 'conflict' | 'user'

type SourceChipProps = {
  source: string
  /** Certainty in words ("Likely — check"), never a percentage. */
  certainty: string
  tone?: SourceTone
  /** Without evidence to open (the operator's own edit) the chip is plain text. */
  onOpen?: () => void
}

/** Opens the provenance viewer, where IDs and digests live. */
export function SourceChip({ source, certainty, tone = 'default', onOpen }: SourceChipProps) {
  if (!onOpen) {
    return (
      <Plain $tone={tone}>
        {source} · {certainty}
      </Plain>
    )
  }
  return (
    <Chip
      type="button"
      $tone={tone}
      aria-label={`Source: ${source}, ${certainty}. Open evidence`}
      onClick={onOpen}
    >
      {source} · {certainty}
    </Chip>
  )
}

const tones = {
  default: css``,
  likely: css`
    border-color: ${color.warn};
    color: ${color.warn};
  `,
  conflict: css`
    border-color: ${color.bad};
    color: ${color.bad};
  `,
  user: css`
    border-color: ${color.accent};
    color: ${color.accent};
  `,
}

const chip = css`
  display: inline-flex;
  align-items: center;
  gap: ${space[2]};
  padding: 0 5px;
  border: 1px solid ${color.line};
  border-radius: ${radius.sm};
  background: ${color.surface};
  color: ${color.muted};
  font-size: 11.5px;
  line-height: 1.6;
  white-space: nowrap;
`

const Plain = styled.span<{ $tone: SourceTone }>`
  ${chip}
  ${({ $tone }) => tones[$tone]}
`

const Chip = styled.button<{ $tone: SourceTone }>`
  ${chip}
  cursor: pointer;
  ${({ $tone }) => tones[$tone]}
  ${linkTouchArea}
  ${hoverTransition}
  &:hover,
  &:focus-visible {
    border-color: ${color.accent};
    color: ${color.accent};
  }
`
