import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Count, Pill, type PillStatus } from './Pill'

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
    ['info', '＋'],
    ['acc', '⟳'],
  ] as const)('uses the %s glyph by default', (tone, glyph) => {
    render(<Pill tone={tone}>Word</Pill>)

    expect(screen.getByText('Word').parentElement).toHaveTextContent(`${glyph}Word`)
  })

  it.each([
    ['running', 'acc', '⟳'],
    ['exists', 'ok', '✓'],
    ['new', 'info', '＋'],
    ['queued', 'outline', '…'],
    ['edited', 'outline', '✎'],
    ['excluded', 'neutral', '–'],
    ['blocking', 'bad', '×'],
  ] as const)('gives the %s status its tone and glyph', (status, tone, glyph) => {
    render(<Pill status={status}>Word</Pill>)
    const pill = screen.getByText('Word').parentElement!

    expect(pill).toHaveTextContent(`${glyph}Word`)
    expect(pill).toHaveAttribute('data-tone', tone)
  })

  it('has no agent status: agent work is marked with AiMark, never a pill', () => {
    // @ts-expect-error The AI-proposed state and its ✦ glyph are retired.
    const retired: PillStatus = 'ai-proposed'

    expect(retired).toBe('ai-proposed')
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

it('draws no glyph slot for a plain chip', () => {
  render(
    <Pill tone="neutral" glyph="">
      Research
    </Pill>,
  )
  expect(screen.getByText('Research').parentElement!.querySelector('i')).toBeNull()
})
