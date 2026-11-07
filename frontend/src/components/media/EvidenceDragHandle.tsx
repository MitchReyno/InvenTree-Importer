import { useDraggable } from '@dnd-kit/react'
import type { ReactNode } from 'react'
import styled from 'styled-components'
import { color, opacity, radius, size, space } from '../../theme/generated/tokens'
import { media } from '../ui/media'

type Props = {
  evidenceId: string
  label: string
  disabled: boolean
  /** Renders the tile, given the handle to draw on it. */
  children: (handle: ReactNode) => ReactNode
}

export function EvidenceDragHandle({ evidenceId, label, disabled, children }: Props) {
  const { ref, handleRef, isDragging } = useDraggable({
    id: `evidence:${evidenceId}`,
    data: { label },
    disabled,
  })
  const handle = (
    <Handle
      ref={handleRef}
      type="button"
      disabled={disabled}
      aria-label={`Drag ${label}`}
      aria-describedby="evidence-drag-instructions"
    >
      <span aria-hidden="true">⠿</span>
    </Handle>
  )

  return (
    <Card ref={ref} $dragging={isDragging}>
      {children(handle)}
    </Card>
  )
}

const Card = styled.div<{ $dragging: boolean }>`
  min-width: 0;
  opacity: ${(p) => (p.$dragging ? opacity.disabled : 1)};
`
// The photo-fg ring stays visible on any picture, as the tile's tick does.
const Handle = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 1px ${space[3]};
  border: 0;
  border-radius: ${radius.sm};
  background: ${color.photoScrim};
  color: ${color.photoFg};
  line-height: 1;
  touch-action: none;
  cursor: grab;
  &:focus-visible {
    outline-color: ${color.photoFg};
  }
  &:disabled {
    opacity: ${opacity.disabled};
    cursor: not-allowed;
  }
  ${media.compact} {
    min-width: ${size.touch};
    min-height: ${size.touch};
  }
`
