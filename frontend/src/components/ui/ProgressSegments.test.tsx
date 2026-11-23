import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ProgressSegments, type ProgressStep } from './ProgressSegments'

const ALL: ProgressStep[] = [
  { label: 'Examine', state: 'done' },
  { label: 'Research', state: 'working', fraction: 7 / 12 },
  { label: 'Images', state: 'waiting_for_you' },
  { label: 'Inventory', state: 'paused', fraction: 0.75 },
  { label: 'Queued', state: 'queued', fraction: 0 },
  { label: 'Later', state: 'not_started' },
  { label: 'Broken', state: 'failed' },
]

function segment(container: HTMLElement, label: string) {
  const index = ALL.findIndex((step) => step.label === label)
  return container.querySelectorAll<HTMLElement>('[data-state]')[index]
}

describe('ProgressSegments', () => {
  it('hides the bars and lists every step and state as text', () => {
    const { container } = render(<ProgressSegments steps={ALL} />)

    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull()
    for (const text of [
      'Examine: done',
      'Research: working',
      'Images: waiting for you',
      'Inventory: paused',
      'Queued: queued',
      'Later: not started',
      'Broken: failed',
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument()
    }
  })

  it('draws each of the seven states apart', () => {
    const { container } = render(<ProgressSegments steps={ALL} />)
    const states = [...container.querySelectorAll('[data-state]')].map((node) =>
      node.getAttribute('data-state'),
    )

    expect(new Set(states).size).toBe(7)
  })

  it('fills a counted stage to its ready share and invents none without a count', () => {
    const { container } = render(<ProgressSegments steps={ALL} />)

    expect(segment(container, 'Research').querySelector('i')).toHaveStyle({ width: '58%' })
    expect(segment(container, 'Inventory').querySelector('i')).toHaveStyle({ width: '75%' })
    // A stage in progress without a count tints its whole bar rather than filling a share.
    expect(segment(container, 'Images').querySelector('i')).toHaveStyle({ width: '0%' })
    expect(segment(container, 'Images')).toHaveAttribute('data-counted', 'false')
    expect(segment(container, 'Examine').querySelector('i')).toHaveStyle({ width: '100%' })
    expect(segment(container, 'Broken').querySelector('i')).toHaveStyle({ width: '100%' })
  })

  it('animates only a working stage, and none from a still read', () => {
    const { container, rerender } = render(<ProgressSegments steps={ALL} />)

    const animated = () =>
      [...container.querySelectorAll('[data-animated="true"]')].map((node) =>
        node.getAttribute('data-state'),
      )

    expect(animated()).toEqual(['working'])
    rerender(<ProgressSegments steps={ALL} still />)
    expect(animated()).toEqual([])
    // Still, the working stage keeps its own state and pattern.
    expect(segment(container, 'Research')).toHaveAttribute('data-state', 'working')
  })
})
