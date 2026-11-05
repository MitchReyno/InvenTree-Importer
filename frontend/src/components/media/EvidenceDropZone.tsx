import { useDroppable } from '@dnd-kit/react'
import type { ReactNode } from 'react'
import styled, { css } from 'styled-components'
import { color, radius, space } from '../../theme/generated/tokens'

type Props = { groupId: string | null; label: string; disabled: boolean; children: ReactNode }

/** A group of evidence, and a drop target for moving files into it. */
export function EvidenceDropZone({ groupId, label, disabled, children }: Props) {
  const { ref, isDropTarget } = useDroppable({
    id: `group:${groupId ?? 'ungrouped'}`,
    data: { label },
    disabled,
  })
  return (
    <Zone
      ref={ref}
      $target={isDropTarget}
      $ungrouped={groupId === null}
      role="region"
      aria-label={label}
    >
      {children}
    </Zone>
  )
}

const Zone = styled.section<{ $target: boolean; $ungrouped: boolean }>`
  display: grid;
  gap: ${space[2]};
  min-width: 0;
  padding: ${space['2-5']};
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
  overflow-wrap: anywhere;
  ${({ $ungrouped }) =>
    $ungrouped &&
    css`
      border-style: dashed;
      background: transparent;
    `}
  ${({ $target }) =>
    $target &&
    css`
      border-color: ${color.accent};
      box-shadow: 0 0 0 3px ${color.accentWeak};
    `}
`
