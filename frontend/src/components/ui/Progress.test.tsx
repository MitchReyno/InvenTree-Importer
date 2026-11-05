import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ProgressSegments, Skeleton, Spinner } from './Progress'

describe('ProgressSegments', () => {
  it('hides the bars and lists every step and state as text', () => {
    const { container } = render(
      <ProgressSegments
        steps={[
          { label: 'Examine', state: 'done' },
          { label: 'Research', state: 'running', fraction: 0.4 },
          { label: 'Images', state: 'waiting' },
        ]}
      />,
    )

    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull()
    expect(screen.getByText('Examine: done')).toBeInTheDocument()
    expect(screen.getByText('Research: running')).toBeInTheDocument()
    expect(screen.getByText('Images: waiting')).toBeInTheDocument()
  })

  it('fills a running step without a fraction to half', () => {
    const { container } = render(
      <ProgressSegments steps={[{ label: 'Research', state: 'running' }]} />,
    )

    expect(container.querySelector('[data-state="running"] i')).toHaveStyle({ width: '50%' })
  })
})

describe('Spinner and Skeleton', () => {
  it('are decorative', () => {
    const { container } = render(
      <>
        <Spinner />
        <Skeleton width="100%" height="80px" />
      </>,
    )

    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2)
  })
})
