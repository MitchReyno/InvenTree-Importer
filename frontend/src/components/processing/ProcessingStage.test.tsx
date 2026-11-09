import { afterEach, expect, test, vi } from 'vitest'
import type { CaptureSnapshotDto } from '@invimport/contracts'
import type { ProcessingClient } from '#/processing/types'
import { render } from '#/test/render'
import { ProcessingStage } from './ProcessingStage'

const workspace = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }))

vi.mock('./ProcessingWorkspace', () => ({
  ProcessingWorkspace: (props: Record<string, unknown>) => {
    workspace.props = props
    return null
  },
}))

afterEach(() => {
  history.replaceState(null, '', '#')
})

const batch = { id: 'batch-1' } as CaptureSnapshotDto

test('Processing gets the batch commands, the dirty callback and route navigation', () => {
  const edit = vi.fn(async () => true)
  const reload = vi.fn(async () => undefined)
  const onDirtyChange = vi.fn()
  render(
    <ProcessingStage
      batch={batch}
      client={{} as ProcessingClient}
      step="examine"
      onDirtyChange={onDirtyChange}
    />,
    { commands: { edit, reload } },
  )
  const props = workspace.props!
  expect(props.edit).toBe(edit)
  expect(props.onSaved).toBe(reload)
  // The workspace owns the guard's release through its own dirty sources.
  expect(props.onDirtyChange).toBe(onDirtyChange)
  expect(props.view).toBe('examine')
  ;(props.navigate as (step: string, question?: string) => void)('research', 'q-1')
  expect(location.hash).toBe('#batch-1/processing/research/q-1')
})
