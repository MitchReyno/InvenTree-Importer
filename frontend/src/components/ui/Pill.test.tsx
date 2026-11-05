import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Count, Pill } from './Pill'

describe('Pill', () => {
  it('pairs a decorative glyph with the status word', () => {
    render(<Pill tone="warn">Needs answer</Pill>)
    const pill = screen.getByText('Needs answer').parentElement!

    expect(pill).toHaveTextContent('?Needs answer')
    expect(pill.querySelector('[aria-hidden="true"]')).toHaveTextContent('?')
  })

  it.each([
    ['ok', '✓'],
    ['bad', '×'],
    ['info', '+'],
  ] as const)('uses the %s glyph by default', (tone, glyph) => {
    render(<Pill tone={tone}>Word</Pill>)

    expect(screen.getByText('Word').parentElement).toHaveTextContent(`${glyph}Word`)
  })

  it('accepts a custom glyph', () => {
    render(
      <Pill tone="acc" glyph="↻">
        Checking
      </Pill>,
    )

    expect(screen.getByText('Checking').parentElement).toHaveTextContent('↻Checking')
  })
})

describe('Count', () => {
  it('shows exact counts up to 999 and then 999+', () => {
    render(
      <>
        <Count value={0} />
        <Count value={42} tone="warn" />
        <Count value={1200} tone="bad" />
      </>,
    )

    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('999+')).toBeInTheDocument()
  })
})
