import { useDraggable } from '@dnd-kit/react'
import type { ReactNode } from 'react'
import styled from 'styled-components'
import { space } from '../../theme/generated/tokens'
import { Button } from '../ui/Button'

type Props = { evidenceId: string; label: string; disabled: boolean; children?: ReactNode }

export function EvidenceDragHandle({ evidenceId, label, disabled, children }: Props) {
  const { ref, handleRef, isDragging } = useDraggable({
    id: `evidence:${evidenceId}`,
    data: { label },
    disabled,
  })
  return (
    <Card ref={ref} $dragging={isDragging}>
      <Handle
        ref={handleRef}
        type="button"
        disabled={disabled}
        aria-label={`Drag ${label}`}
        aria-describedby="evidence-drag-instructions"
      >
        Move evidence
      </Handle>
      {children}
    </Card>
  )
}

const Card = styled.div<{ $dragging: boolean }>`
  min-width: 0;
  opacity: ${(p) => (p.$dragging ? 0.6 : 1)};
`
const Handle = styled(Button)`
  touch-action: none;
  cursor: grab;
  margin-bottom: ${space[4]};
`
