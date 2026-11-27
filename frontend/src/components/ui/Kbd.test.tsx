import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Kbd } from './Kbd'

describe('Kbd', () => {
  it('marks up a keyboard key', () => {
    render(<Kbd>J</Kbd>)

    expect(screen.getByText('J').tagName).toBe('KBD')
  })
})
