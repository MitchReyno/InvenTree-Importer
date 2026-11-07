import type { ReactNode } from 'react'
import styled, { css } from 'styled-components'
import { color, icon, radius, space, type } from '../../theme/generated/tokens'
import { formatCount } from './media'

export type PillTone = 'ok' | 'warn' | 'bad' | 'info' | 'acc' | 'neutral' | 'outline'

/** Status never relies on colour alone: each tone has a default glyph beside its word. */
export const TONE_GLYPH: Record<PillTone, string> = {
  ok: '✓',
  warn: '?',
  bad: '×',
  info: '+',
  acc: '•',
  neutral: '–',
  outline: '–',
}

type PillProps = { tone: PillTone; glyph?: string; children: ReactNode }

export function Pill({ tone, glyph = TONE_GLYPH[tone], children }: PillProps) {
  return (
    <PillBody $tone={tone}>
      <i aria-hidden="true">{glyph}</i>
      <span>{children}</span>
    </PillBody>
  )
}

export type CountTone = 'default' | 'warn' | 'ok' | 'bad'

export function Count({ value, tone = 'default' }: { value: number; tone?: CountTone }) {
  return <CountBody $tone={tone}>{formatCount(value)}</CountBody>
}

/** A short attention label in count styling, such as "3 to decide" on a tab. */
export function Badge({ tone, children }: { tone: CountTone; children: ReactNode }) {
  return <CountBody $tone={tone}>{children}</CountBody>
}

const pillTones = {
  ok: css`
    background: ${color.okWeak};
    color: ${color.ok};
  `,
  warn: css`
    background: ${color.warnWeak};
    color: ${color.warn};
  `,
  bad: css`
    background: ${color.badWeak};
    color: ${color.bad};
  `,
  info: css`
    background: ${color.infoWeak};
    color: ${color.info};
  `,
  acc: css`
    background: ${color.accentWeak};
    color: ${color.accent};
  `,
  neutral: css`
    background: ${color.surface2};
    color: ${color.muted};
  `,
  outline: css`
    background: transparent;
    border-color: ${color.lineStrong};
    color: ${color.muted};
  `,
}

const PillBody = styled.span<{ $tone: PillTone }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: ${space[1]} 9px ${space[1]} 7px;
  border: 1px solid transparent;
  border-radius: ${radius.pill};
  white-space: nowrap;
  ${type.pill}
  ${({ $tone }) => pillTones[$tone]}
  i {
    width: ${icon.sm};
    font-style: normal;
    font-size: 11px;
    text-align: center;
  }
`

const countTones = {
  default: css`
    background: ${color.surface2};
    color: ${color.muted};
  `,
  warn: css`
    background: ${color.warnWeak};
    color: ${color.warn};
  `,
  ok: css`
    background: ${color.okWeak};
    color: ${color.ok};
  `,
  bad: css`
    background: ${color.badWeak};
    color: ${color.bad};
  `,
}

const CountBody = styled.span<{ $tone: CountTone }>`
  padding: 1px 7px;
  border-radius: 10px;
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  ${({ $tone }) => countTones[$tone]}
`
