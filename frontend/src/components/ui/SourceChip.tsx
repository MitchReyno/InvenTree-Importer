import { useState } from 'react'
import styled, { css } from 'styled-components'
import { color, radius, space } from '#/theme/generated/tokens'
import { InfoIcon } from './icons'
import { hoverTransition } from './motion'
import { Popover } from './Popover'
import { linkTouchArea } from './primitives'
import { SourceChipPopover, type SourceDetails } from './SourceChipPopover'

export type SourceTone = 'default' | 'likely' | 'conflict' | 'user'

/** Certainties that need attention lead with a glyph, so the chip never relies on colour. */
const TONE_GLYPH: Record<SourceTone, string | null> = {
  default: null,
  likely: '?',
  conflict: '×',
  user: '✎',
}

type SourceChipProps = SourceDetails & {
  source: string
  /** Certainty in words ("Likely — check"), never a percentage. */
  certainty: string
  tone?: SourceTone
}

/**
 * Every proposed value carries its source. The chip shows only the source and an info icon; its
 * certainty, why and evidence open in a popover. IDs and digests stay in the evidence viewer.
 */
export function SourceChip({ source, certainty, tone = 'default', ...details }: SourceChipProps) {
  const [open, setOpen] = useState(false)
  const glyph = TONE_GLYPH[tone]
  const title = details.field ? `${details.field} source` : `Source: ${source}`

  return (
    <Popover
      label={title}
      open={open}
      onOpenChange={setOpen}
      align="start"
      width="320px"
      trigger={
        <Chip
          type="button"
          $tone={tone}
          aria-label={`Source: ${source}, ${certainty}. Show details.`}
          title={`${source} · ${certainty}`}
        >
          {glyph && <b aria-hidden="true">{glyph}</b>}
          {source}
          <InfoIcon data-more="" />
        </Chip>
      }
    >
      <SourceChipPopover
        certainty={certainty}
        tone={tone}
        close={() => setOpen(false)}
        {...details}
      />
    </Popover>
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

const Chip = styled.button<{ $tone: SourceTone }>`
  display: inline-flex;
  align-items: center;
  gap: ${space[2]};
  padding: 0 5px;
  border: 1px solid ${color.line};
  border-radius: ${radius.sm};
  background: ${color.surface};
  color: ${color.muted};
  font: inherit;
  /* literal-allowed: the chip reads one step under small text, as in the design system */
  font-size: 11.5px;
  line-height: 1.6;
  white-space: nowrap;
  cursor: pointer;
  ${({ $tone }) => tones[$tone]}
  ${linkTouchArea}
  ${hoverTransition}
  &:hover,
  &:focus-visible,
  &[aria-expanded='true'] {
    border-color: ${color.accent};
    color: ${color.accent};
  }
  b {
    font-weight: 700;
  }
  [data-more] {
    flex: none;
    width: 11px;
    height: 11px;
    opacity: 0.8;
  }
`
