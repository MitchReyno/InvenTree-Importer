import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, it } from 'vitest'
import { ConfirmationProvider, useConfirmation } from './ConfirmationContext'

function Command({ onDone }: { onDone: () => void }) {
  const confirm = useConfirmation()
  return (
    <button
      type="button"
      onClick={() => {
        confirm('Marked 1 lot reviewed')
        onDone()
      }}
    >
      Mark
    </button>
  )
}

/** A confirmed command reloads a new revision, which remounts the revision-keyed workspace. */
function Workspace() {
  const [revision, setRevision] = useState(1)
  return <Command key={revision} onDone={() => setRevision((value) => value + 1)} />
}

it('keeps a confirmation through the remount that a new revision causes', async () => {
  render(
    <ConfirmationProvider>
      <Workspace />
    </ConfirmationProvider>,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Mark' }))
  expect(screen.getByRole('status')).toHaveTextContent('Marked 1 lot reviewed')
})
