import type { ReactNode } from 'react'
import styled from 'styled-components'
import { color, radius, space, typeVar } from '#/theme/generated/tokens'

/** The InvenTree target a change goes to, in the masthead connection chip's style. */
export function TargetChip({ children }: { children: ReactNode }) {
  return (
    <Chip data-target>
      <Dot aria-hidden="true" />
      {children}
    </Chip>
  )
}

const Chip = styled.span`
  display: inline-flex;
  align-items: center;
  gap: ${space[3]};
  padding: ${space[1]} ${space[5]};
  border: 1px solid ${color.line};
  border-radius: ${radius.pill};
  background: ${color.surface};
  color: ${color.fg};
  font-size: ${typeVar.small.size};
  white-space: nowrap;
`

const Dot = styled.span`
  width: ${space[4]};
  height: ${space[4]};
  border-radius: ${radius.pill};
  background: ${color.info};
`
