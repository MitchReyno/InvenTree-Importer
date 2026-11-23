import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatePill, WORK_STATE, type WorkState } from './StatePill'

describe('StatePill', () => {
  it.each([
    ['working', 'Working', '⟳', 'acc'],
    ['waiting_for_you', 'Waiting for you', '?', 'warn'],
    ['queued', 'Queued', '…', 'outline'],
    ['paused', 'Paused', '⏸', 'neutral'],
    ['done', 'Done', '✓', 'ok'],
    ['failed', 'Failed', '×', 'bad'],
    ['not_started', 'Not started', '–', 'outline'],
  ] as const)('draws %s as its word beside its own glyph', (state, word, glyph, tone) => {
    render(<StatePill state={state} />)
    const pill = screen.getByText(word).parentElement!

    expect(pill).toHaveAttribute('data-tone', tone)
    expect(pill.querySelector('[aria-hidden="true"]')).toHaveTextContent(glyph)
  })

  it('gives every state a glyph of its own, so colour is never the only cue', () => {
    const glyphs = Object.values(WORK_STATE).map((entry) => entry.glyph)

    expect(new Set(glyphs).size).toBe(Object.keys(WORK_STATE).length)
  })

  it('adds a detail after the state word', () => {
    render(<StatePill state={'waiting_for_you' satisfies WorkState} detail="2" />)

    expect(screen.getByText('Waiting for you · 2')).toBeInTheDocument()
  })

  it('puts a leading count in place of the state word', () => {
    render(<StatePill state="working" label="2 working" />)

    expect(screen.getByText('2 working')).toBeInTheDocument()
    expect(screen.queryByText('Working')).not.toBeInTheDocument()
  })
})
