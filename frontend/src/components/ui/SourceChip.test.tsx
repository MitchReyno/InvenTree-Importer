import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SourceChip } from './SourceChip'

describe('SourceChip', () => {
  it('names the source and certainty in words and opens the evidence', async () => {
    const onOpen = vi.fn()
    render(<SourceChip source="Packet label" certainty="Label and slip agree" onOpen={onOpen} />)
    const chip = screen.getByRole('button', {
      name: 'Source: Packet label, Label and slip agree. Open evidence',
    })

    expect(chip).toHaveTextContent('Packet label · Label and slip agree')
    await userEvent.click(chip)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('opens from the keyboard', async () => {
    const onOpen = vi.fn()
    render(<SourceChip source="Agent" certainty="Likely — check" tone="likely" onOpen={onOpen} />)

    await userEvent.tab()
    await userEvent.keyboard('{Enter}')
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})
