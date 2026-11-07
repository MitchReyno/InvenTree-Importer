import { useDroppable } from '@dnd-kit/react'

/** Makes an evidence group a drop target for moving files into it. */
export function useEvidenceDropZone(groupId: string | null, label: string, disabled: boolean) {
  const { ref, isDropTarget } = useDroppable({
    id: `group:${groupId ?? 'ungrouped'}`,
    data: { label },
    disabled,
  })
  return { ref, dropState: isDropTarget ? ('over' as const) : ('none' as const) }
}
