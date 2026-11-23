import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { PageContent } from './AppLayout'

test('a page wrapper after another is one page gap below it, not a second top inset', () => {
  render(
    <>
      <PageContent $width="content" data-testid="alerts" />
      <PageContent $width="content" data-testid="page" />
    </>,
  )

  expect(getComputedStyle(screen.getByTestId('alerts')).paddingTop).not.toBe('var(--space-7)')
  expect(getComputedStyle(screen.getByTestId('page')).paddingTop).toBe('var(--space-7)')
})
