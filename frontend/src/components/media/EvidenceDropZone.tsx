import { useDroppable } from '@dnd-kit/react'
import type { ReactNode } from 'react'
import styled from 'styled-components'
import { color } from '../../theme/generated/tokens'

type Props = { groupId: string | null; label: string; disabled: boolean; children: ReactNode }

export function EvidenceDropZone({ groupId, label, disabled, children }: Props) {
  const { ref, isDropTarget } = useDroppable({
    id: `group:${groupId ?? 'ungrouped'}`,
    data: { label },
    disabled,
  })
  return (
    <Zone ref={ref} $target={isDropTarget} role="region" aria-label={label}>
      {children}
    </Zone>
  )
}

const Zone = styled.section<{ $target: boolean }>`
  min-width: 0;
  min-height: 110px;
  padding: 12px;
  border: 2px dashed ${(p) => (p.$target ? color.accent : color.lineStrong)};
  border-radius: 6px;
  background: ${(p) => (p.$target ? color.accentWeak : color.surface2)};
  overflow-wrap: anywhere;
`
