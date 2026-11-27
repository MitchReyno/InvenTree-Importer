import { render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { Heading, PageStack, PageTitle, Panel } from './primitives'

afterEach(() => {
  document.documentElement.dataset.masthead = 'bar'
})

function patched(element: HTMLElement): boolean {
  return getComputedStyle(element).backgroundColor.includes('masthead-ground')
}

test('a title placed on the field gets a ground patch only behind the whole window', () => {
  render(<PageTitle $onField>Batches</PageTitle>)
  const title = screen.getByRole('heading', { name: 'Batches' })

  document.documentElement.dataset.masthead = 'bar'
  expect(patched(title)).toBe(false)

  document.documentElement.dataset.masthead = 'window'
  expect(patched(title)).toBe(true)
})

test('titles and headings inside a panel never get a patch', () => {
  document.documentElement.dataset.masthead = 'window'
  render(
    <Panel>
      <PageTitle>Local setup required</PageTitle>
      <Heading>Details</Heading>
    </Panel>,
  )

  expect(patched(screen.getByRole('heading', { name: 'Local setup required' }))).toBe(false)
  expect(patched(screen.getByRole('heading', { name: 'Details' }))).toBe(false)
})

test('a page stack spaces its sections by the page gap and clears their outer margins', () => {
  const absent = false
  render(
    <PageStack data-testid="stack">
      <Panel>Filters</Panel>
      {absent && <Panel>Never shown</Panel>}
      <Panel>Grid</Panel>
    </PageStack>,
  )
  const stack = screen.getByTestId('stack')

  expect(getComputedStyle(stack).getPropertyValue('gap')).toBe('var(--space-7)')
  expect(stack.children).toHaveLength(2)
  for (const section of stack.children) {
    expect(getComputedStyle(section).marginBottom).toBe('0px')
    expect(getComputedStyle(section).marginTop).toBe('0px')
  }
})
