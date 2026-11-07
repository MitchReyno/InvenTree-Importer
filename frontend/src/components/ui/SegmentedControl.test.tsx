import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { FilterChips } from './FilterChips'
import { SegmentedControl } from './SegmentedControl'

function Views() {
  const [value, setValue] = useState('workspace')
  return (
    <SegmentedControl
      label="View"
      value={value}
      onChange={setValue}
      options={[
        { id: 'workspace', label: 'Workspace' },
        { id: 'table', label: 'Table' },
        { id: 'map', label: 'Map' },
      ]}
    />
  )
}

describe('SegmentedControl', () => {
  it('moves the tab stop with focus, so Shift+Tab leaves the group after arrowing', async () => {
    render(
      <>
        <button type="button">Before</button>
        <Views />
      </>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Before' }))
    await userEvent.tab()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('button', { name: 'Table' })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Workspace' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await userEvent.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Before' })).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Table' })).toHaveFocus()
  })

  it('is a labelled group of pressed buttons with one tab stop', async () => {
    render(<Views />)

    expect(screen.getByRole('group', { name: 'View' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Workspace' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Workspace' })).toHaveFocus()
    await userEvent.tab()
    expect(document.body).toHaveFocus()
  })

  it('moves focus with arrow keys, wrapping, and selects with Space or Enter', async () => {
    render(<Views />)

    await userEvent.tab()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('button', { name: 'Table' })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Workspace' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await userEvent.keyboard(' ')
    expect(screen.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true')

    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    expect(screen.getByRole('button', { name: 'Workspace' })).toHaveFocus()
    await userEvent.keyboard('{ArrowLeft}{Enter}')
    expect(screen.getByRole('button', { name: 'Map' })).toHaveAttribute('aria-pressed', 'true')
  })
})

function Filters() {
  const [value, setValue] = useState('all')
  return (
    <FilterChips
      label="Filter lots"
      value={value}
      onChange={setValue}
      options={[
        { id: 'all', label: 'All', count: 12 },
        { id: 'blocked', label: 'Blocked', count: 0 },
      ]}
    />
  )
}

describe('FilterChips', () => {
  it('always shows counts, zero included, and selects by click or keyboard', async () => {
    render(<Filters />)

    expect(screen.getByRole('button', { name: 'Blocked, 0' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Blocked, 0' }))
    expect(screen.getByRole('button', { name: 'Blocked, 0' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await userEvent.keyboard('{ArrowLeft}{Enter}')
    expect(screen.getByRole('button', { name: 'All, 12' })).toHaveAttribute('aria-pressed', 'true')
  })
})
