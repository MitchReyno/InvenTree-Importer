import styled from 'styled-components'
import { color, radius } from '#/theme/generated/tokens'
import type { TargetStatus } from '#/header/observations'

const dotTone = {
  ok: color.ok,
  info: color.info,
  warn: color.warn,
  bad: color.bad,
  muted: color.muted,
}

/** The connection's toned dot; always paired with words, never colour alone. */
export function ConnectionDot({ tone }: { tone: TargetStatus['tone'] }) {
  return <Dot aria-hidden="true" data-tone={tone} $tone={tone} />
}

const Dot = styled.span<{ $tone: TargetStatus['tone'] }>`
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: ${radius.round};
  background: ${({ $tone }) => dotTone[$tone]};
`
