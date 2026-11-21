import { render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { Heading, PageTitle, Panel } from './primitives'

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
