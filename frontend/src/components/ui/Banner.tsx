import type { ReactNode } from 'react'
import styled, { css } from 'styled-components'
import { color, icon, radius, space, typeVar } from '../../theme/generated/tokens'
import { linkTouchArea } from './primitives'

export type BannerTone = 'info' | 'warn' | 'bad' | 'ok' | 'plain'

const BANNER_GLYPH: Record<BannerTone, string> = {
  info: 'i',
  warn: '!',
  bad: '×',
  ok: '✓',
  plain: '•',
}

type BannerProps = { tone: BannerTone; icon?: string; action?: ReactNode; children: ReactNode }

/** At most one per page, at the top of the content column. */
export function Banner({ tone, icon = BANNER_GLYPH[tone], action, children }: BannerProps) {
  return (
    <Body $tone={tone}>
      <Icon aria-hidden="true" $tone={tone}>
        {icon}
      </Icon>
      <Message>{children}</Message>
      {action}
    </Body>
  )
}

const grounds = {
  info: color.accentWeak,
  warn: color.warnWeak,
  bad: color.badWeak,
  ok: color.okWeak,
  plain: color.surface,
}

const inks = {
  info: color.accent,
  warn: color.warn,
  bad: color.bad,
  ok: color.ok,
  plain: color.muted,
}

const Body = styled.div<{ $tone: BannerTone }>`
  display: flex;
  align-items: flex-start;
  gap: ${space[5]};
  padding: ${space[5]} ${space[7]};
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  a {
    color: inherit;
    font-weight: ${typeVar.bodyStrong.weight};
    ${linkTouchArea}
  }
  ${({ $tone }) => css`
    background: ${grounds[$tone]};
    border-color: ${$tone === 'plain' ? color.line : 'transparent'};
  `}
`

const Icon = styled.span<{ $tone: BannerTone }>`
  flex: none;
  width: ${icon.md};
  font-weight: 700;
  text-align: center;
  color: ${({ $tone }) => inks[$tone]};
`

const Message = styled.div`
  flex: 1;
  min-width: 0;
`
