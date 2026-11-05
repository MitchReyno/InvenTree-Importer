import { useId, type ReactNode } from 'react'
import styled, { css, keyframes } from 'styled-components'
import { color, space, type } from '../../theme/generated/tokens'
import { media } from './media'
import type { StepState } from './Progress'
import { VisuallyHidden } from './Progress'

type PhaseRowProps = {
  state: StepState
  title: string
  outcome: string
  badges?: ReactNode
  expanded: boolean
  onToggle: () => void
  children?: ReactNode
}

const STATE_TEXT: Record<StepState, { glyph: string; word: string }> = {
  done: { glyph: '✓', word: 'Done' },
  running: { glyph: '•', word: 'Running' },
  waiting: { glyph: '', word: 'Waiting' },
}

/** One processing step as a disclosure; the panel holds its detail. */
export function PhaseRow({
  state,
  title,
  outcome,
  badges,
  expanded,
  onToggle,
  children,
}: PhaseRowProps) {
  const panelId = useId()
  const status = STATE_TEXT[state]

  return (
    <div>
      <Header type="button" aria-expanded={expanded} aria-controls={panelId} onClick={onToggle}>
        <Disc aria-hidden="true" $state={state}>
          {status.glyph}
        </Disc>
        <span>
          <Title>{title}</Title>
          <VisuallyHidden>, </VisuallyHidden>
          <State>{status.word}</State>
          <Outcome>{outcome}</Outcome>
        </span>
        <Badges>{badges}</Badges>
        <Caret aria-hidden="true">{expanded ? '▾' : '▸'}</Caret>
      </Header>
      {expanded && <Panel id={panelId}>{children}</Panel>}
    </div>
  )
}

const pulse = keyframes`
  from { opacity: 0.6; }
  to { opacity: 1; }
`

const Header = styled.button`
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) auto 14px;
  align-items: center;
  gap: ${space['2-5']};
  width: 100%;
  padding: ${space[3]} ${space[4]};
  border: 0;
  border-top: 1px solid ${color.line};
  background: none;
  text-align: left;
  cursor: pointer;
  &:hover {
    background: ${color.surface2};
  }
`

const discs = {
  done: css`
    background: ${color.okWeak};
    color: ${color.ok};
    border-color: ${color.ok};
  `,
  running: css`
    background: ${color.accentWeak};
    color: ${color.accent};
    border-color: ${color.accent};
    animation: ${pulse} 1600ms ease-in-out infinite alternate;
  `,
  waiting: css`
    background: transparent;
    color: ${color.muted};
    border-color: ${color.lineStrong};
  `,
}

const Disc = styled.span<{ $state: StepState }>`
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border: 1.5px solid;
  border-radius: 50%;
  font-size: 12px;
  font-weight: 700;
  ${({ $state }) => discs[$state]}
  ${media.reducedMotion} {
    animation: none;
  }
`

const Title = styled.span`
  ${type.h3}
`

const State = styled.span`
  margin-left: ${space[2]};
  font-size: 12px;
  font-weight: 600;
  color: ${color.muted};
`

const Outcome = styled.span`
  display: block;
  margin-top: 2px;
  font-size: 12.5px;
  color: ${color.muted};
`

const Badges = styled.span`
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: ${space[1]};
`

const Caret = styled.span`
  color: ${color.muted};
`

const Panel = styled.div`
  padding: 0 ${space[4]} ${space[3]};
`
