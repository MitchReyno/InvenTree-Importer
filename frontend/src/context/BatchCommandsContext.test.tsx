import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { expect, test } from 'vitest'
import { batchCommands } from '#/test/batch-commands'
import { BatchCommandsProvider, useBatchCommands } from './BatchCommandsContext'

test('outside a batch the commands are refused loudly', () => {
  expect(() => renderHook(() => useBatchCommands())).toThrow(
    'useBatchCommands needs a BatchCommandsProvider',
  )
})

test('a batch provides its commands to every consumer', () => {
  const commands = batchCommands()

  const wrapper = ({ children }: { children: ReactNode }) => (
    <BatchCommandsProvider value={commands}>{children}</BatchCommandsProvider>
  )

  const { result } = renderHook(() => useBatchCommands(), { wrapper })
  expect(result.current).toBe(commands)
})
