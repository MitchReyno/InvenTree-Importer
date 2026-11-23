import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatePill, type WorkState } from './StatePill'

const WORDS: [WorkState, string, string][] = [
  ['working', 'Working', '⟳'],
  ['waiting_for_you', 'Waiting for you', '?'],
  ['queued', 'Queued', '…'],
  ['paused', 'Paused', '‖'],
  ['done', 'Done', '✓'],
  ['failed', 'Failed', '×'],
  ['not_started', 'Not started', '○'],
]

describe('StatePill', () => {
  it('draws each work state with its own word and glyph', () => {
    const { container } = render(
      <>
        {WORDS.map(([state]) => (
          <StatePill key={state} state={state} />
        ))}
      </>,
    )

    const pills = [...container.querySelectorAll('[data-tone]')]
    expect(pills.map((pill) => pill.textContent)).toEqual(
      WORDS.map(([, word, glyph]) => `${glyph}${word}`),
    )
    expect(new Set(WORDS.map(([, , glyph]) => glyph)).size).toBe(WORDS.length)
  })

  it('takes a fuller word, such as how many are working', () => {
    render(<StatePill state="working">2 working</StatePill>)

    expect(screen.getByText('2 working')).toBeInTheDocument()
  })
})
