import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SourceChip } from './SourceChip'

describe('SourceChip', () => {
  it('shows only the source, with source and certainty in its name and tooltip', () => {
    render(<SourceChip source="Packet label" certainty="Label and slip agree" />)
    const chip = screen.getByRole('button', {
      name: 'Source: Packet label, Label and slip agree. Show details.',
    })

    expect(chip).toHaveTextContent(/^Packet label$/)
    expect(chip).toHaveAttribute('title', 'Packet label · Label and slip agree')
    expect(chip).not.toHaveTextContent('Label and slip agree')
  })

  it.each([
    ['likely', 'Likely — check', '?'],
    ['conflict', 'Sources disagree', '×'],
    ['user', 'Your edit', '✎'],
  ] as const)('puts the %s glyph before the source', (tone, certainty, glyph) => {
    render(<SourceChip source="Photo" certainty={certainty} tone={tone} />)
    const chip = screen.getByRole('button', { name: `Source: Photo, ${certainty}. Show details.` })

    expect(chip).toHaveTextContent(`${glyph}Photo`)
    expect(within(chip).getByText(glyph)).toHaveAttribute('aria-hidden', 'true')
  })

  it('shows no glyph for a confirming certainty', () => {
    render(<SourceChip source="Datasheet" certainty="Matches datasheet" />)

    expect(screen.getByRole('button')).toHaveTextContent(/^Datasheet$/)
  })

  it('opens the details, closes on Escape and returns focus', async () => {
    const user = userEvent.setup()
    render(
      <SourceChip
        source="Packet label"
        certainty="Label and slip agree"
        field="Resistance"
        value="10 kΩ"
        why="Read “RES 10K 1%” from the label; the packing slip says 10K too."
        evidence={<span>Packet A · front, label crop</span>}
      />,
    )
    const chip = screen.getByRole('button', { name: /^Source: Packet label/ })
    await user.click(chip)

    const details = await screen.findByRole('dialog', { name: 'Resistance source' })
    expect(details).toHaveTextContent('Resistance · 10 kΩ')
    expect(details).toHaveTextContent('Label and slip agree')
    expect(details).toHaveTextContent('Read “RES 10K 1%” from the label')
    expect(details).toHaveTextContent('Packet A · front, label crop')
    expect(chip).toHaveAttribute('aria-expanded', 'true')

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(chip).toHaveFocus()
  })

  it('opens from the keyboard and offers Open evidence and Edit value', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    const onEdit = vi.fn()
    render(
      <SourceChip
        source="Agent"
        certainty="Likely — check"
        tone="likely"
        onOpen={onOpen}
        onEdit={onEdit}
      />,
    )

    await user.tab()
    await user.keyboard('{Enter}')
    const details = await screen.findByRole('dialog', { name: 'Source: Agent' })
    await user.click(within(details).getByRole('button', { name: 'Open evidence' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /^Source: Agent/ }))
    await user.click(await screen.findByRole('button', { name: 'Edit value' }))
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('offers no actions it cannot take', async () => {
    const user = userEvent.setup()
    render(<SourceChip source="You" certainty="Your edit" tone="user" />)
    await user.click(screen.getByRole('button', { name: 'Source: You, Your edit. Show details.' }))
    const details = await screen.findByRole('dialog', { name: 'Source: You' })

    expect(within(details).queryByRole('button', { name: 'Open evidence' })).toBeNull()
    expect(within(details).queryByRole('button', { name: 'Edit value' })).toBeNull()
    expect(details).toHaveTextContent('Your edit')
  })
})
