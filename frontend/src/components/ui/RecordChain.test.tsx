import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RecordChain } from './RecordChain'

describe('RecordChain', () => {
  it('lists each record with its kind and state in words', () => {
    render(
      <RecordChain
        links={[
          { kind: 'Manufacturer', label: 'Yageo', state: 'exists', href: '#m' },
          { kind: 'Part', label: 'RC0603FR-0710KL', state: 'new', href: '#p' },
          { kind: 'Supplier part', label: 'Mouser 603-RC0603FR', state: 'choose', href: '#s' },
        ]}
      />,
    )

    expect(screen.getByRole('list', { name: 'Record chain' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Manufacturer Yageo: exists' })).toHaveAttribute(
      'href',
      '#m',
    )
    expect(screen.getByRole('link', { name: 'Part RC0603FR-0710KL: new' })).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Supplier part Mouser 603-RC0603FR: choose' }),
    ).toBeInTheDocument()
  })
})
