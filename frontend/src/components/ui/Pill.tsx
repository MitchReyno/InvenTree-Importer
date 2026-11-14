import type { ReactNode } from 'react'
import styled, { css } from 'styled-components'
import { color, icon, radius, space, type, typeVar } from '#/theme/generated/tokens'
import { formatCount } from './media'

export type PillTone = 'ok' | 'warn' | 'bad' | 'info' | 'acc' | 'neutral' | 'outline'

/** Status never relies on colour alone: each tone has a default glyph beside its word. */
export const TONE_GLYPH: Record<PillTone, string> = {
  ok: '✓',
  warn: '?',
  bad: '×',
  info: '＋',
  acc: '⟳',
  neutral: '–',
  outline: '–',
}

/** The design system's status vocabulary: each state's tone and glyph, the same on every screen. */
const STATUS = {
  ready: { tone: 'ok', glyph: '✓' },
  exists: { tone: 'ok', glyph: '✓' },
  complete: { tone: 'ok', glyph: '✓' },
  'needs-answer': { tone: 'warn', glyph: '?' },
  warning: { tone: 'warn', glyph: '!' },
  duplicate: { tone: 'warn', glyph: '≈' },
  blocking: { tone: 'bad', glyph: '×' },
  failed: { tone: 'bad', glyph: '×' },
  new: { tone: 'info', glyph: '＋' },
  processing: { tone: 'info', glyph: '⟳' },
  update: { tone: 'acc', glyph: '⟳' },
  running: { tone: 'acc', glyph: '⟳' },
  selected: { tone: 'acc', glyph: '⟳' },
  excluded: { tone: 'neutral', glyph: '–' },
  queued: { tone: 'outline', glyph: '…' },
  deferred: { tone: 'outline', glyph: '⏸' },
  draft: { tone: 'outline', glyph: '✎' },
  edited: { tone: 'outline', glyph: '✎' },
} as const satisfies Record<string, { tone: PillTone; glyph: string }>

export type PillStatus = keyof typeof STATUS

type PillProps =
  | { status: PillStatus; tone?: never; glyph?: never; children: ReactNode }
  | { status?: never; tone: PillTone; glyph?: string; children: ReactNode }

export function Pill(props: PillProps) {
  const tone = props.status ? STATUS[props.status].tone : props.tone
  const glyph = props.status ? STATUS[props.status].glyph : (props.glyph ?? TONE_GLYPH[props.tone])
  const { children } = props
  return (
    <PillBody $tone={tone} data-tone={tone}>
      {/* An empty glyph means a plain chip, such as a step name, with no glyph slot. */}
      {glyph !== '' && <i aria-hidden="true">{glyph}</i>}
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
  return (
    <CountBody $tone={tone} data-tone={tone}>
      {children}
    </CountBody>
  )
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
  padding: ${space[1]} calc(${space[5]} - 1px) ${space[1]} calc(${space[4]} - 1px);
  border: 1px solid transparent;
  border-radius: ${radius.pill};
  white-space: nowrap;
  ${type.pill}
  ${({ $tone }) => pillTones[$tone]}
  i {
    width: ${icon.sm};
    font-style: normal;
    /* literal-allowed: the status glyph, a step under the pill text */
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
  padding: 1px calc(${space[4]} - 1px);
  border-radius: ${radius.pill};
  font-size: ${typeVar.pill.size};
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  ${({ $tone }) => countTones[$tone]}
`
