import { Accessibility, defaultPreset } from '@dnd-kit/dom'
import {
  DragDropProvider,
  KeyboardSensor,
  PointerSensor,
  type DragEndEvent,
  type DragStartEvent,
  type DragOverEvent,
} from '@dnd-kit/react'
import { useState, type ReactNode } from 'react'
import { Small } from '../ui/primitives'

function labelOf(entity: { data?: { label?: unknown } } | null | undefined): string {
  return typeof entity?.data?.label === 'string' ? entity.data.label : 'Evidence'
}

const sensors = [PointerSensor, KeyboardSensor.configure({ offset: 50 })]
const accessibility = Accessibility.configure({
  screenReaderInstructions: {
    draggable:
      'Press Space or Enter to pick up evidence. Use arrow keys to move towards a group. Confirm with Space or Enter, or cancel with Escape. Selection and Move controls are also available.',
  },
  announcements: {
    dragstart: ({ operation }: DragStartEvent) => `Moving ${labelOf(operation.source)}.`,
    dragover: ({ operation }: DragOverEvent) =>
      operation.target ? `Destination: ${labelOf(operation.target)}.` : 'No destination selected.',
    dragend: (event: DragEndEvent) =>
      event.canceled
        ? 'Move cancelled.'
        : 'Drag ended. Membership confirmation is reported separately.',
  },
})
const plugins = [
  ...defaultPreset.plugins.filter((plugin) => plugin !== Accessibility),
  accessibility,
]

export type EvidenceMoveOutcome = 'saved' | 'unchanged' | 'unconfirmed'

type Props = {
  children: ReactNode
  disabled: boolean
  onMove: (evidenceId: string, groupId: string | null) => Promise<EvidenceMoveOutcome>
  onDraggingChange?: (dragging: boolean) => void
}

export function EvidenceDragContext({ children, disabled, onMove, onDraggingChange }: Props) {
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)

  async function finish(event: DragEndEvent) {
    const source = event.operation.source?.id
    const target = event.operation.target?.id
    if (event.canceled) {
      setMessage('Move cancelled. Nothing was moved.')
      onDraggingChange?.(false)
      return
    }
    if (
      typeof source !== 'string' ||
      !source.startsWith('evidence:') ||
      typeof target !== 'string' ||
      !target.startsWith('group:')
    ) {
      setMessage('No destination chosen. Nothing was moved.')
      onDraggingChange?.(false)
      return
    }
    setSaving(true)
    setMessage('Saving evidence membership…')
    try {
      const group = target.slice('group:'.length)
      const outcome = await onMove(
        source.slice('evidence:'.length),
        group === 'ungrouped' ? null : group,
      )
      if (outcome === 'saved') {
        setMessage('Evidence membership saved.')
      } else if (outcome === 'unchanged') {
        setMessage('Already in that group. Nothing was moved.')
      } else {
        setMessage('Move not confirmed. Selection is retained for reconciliation.')
      }
    } catch {
      setMessage('Move not confirmed. Selection is retained for reconciliation.')
    } finally {
      setSaving(false)
      onDraggingChange?.(false)
    }
  }

  return (
    <DragDropProvider
      sensors={sensors}
      plugins={plugins}
      onBeforeDragStart={(event) => {
        if (disabled || saving) {
          event.preventDefault()
        }
      }}
      onDragStart={() => {
        setMessage('Moving evidence. Choose a destination or cancel with Escape.')
        onDraggingChange?.(true)
      }}
      onDragEnd={(event) => {
        void finish(event)
      }}
    >
      <Small id="evidence-drag-instructions">
        Drag a file by the ⠿ handle on its tile. With keyboard, press Space or Enter on the handle,
        use arrow keys to choose a group, then confirm; Escape cancels. Selection and Move controls
        provide an equivalent path.
      </Small>
      {children}
      <Small role="status" aria-live="polite">
        {message}
      </Small>
    </DragDropProvider>
  )
}
