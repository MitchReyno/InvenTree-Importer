import { screen, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import { render } from '#/test/render'
import { AppMasthead } from './AppMasthead'

const batchId = '10000000-0000-4000-8000-000000000001'

function trail() {
  // Separators are drawn as "/" between the items.
  return screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent?.split('/')
}

test('inside a batch the trail reads "Batches" only, linking back, and never the batch title', () => {
  render(<AppMasthead route={`${batchId}/review/lots`} status={null} />)

  expect(trail()).toEqual(['Batches'])
  expect(
    within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', {
      name: 'Batches',
    }),
  ).toHaveAttribute('href', '#')
})

test('app pages name the page after Batches, including any settings section', () => {
  const { unmount } = render(<AppMasthead route="agents" status={null} />)
  expect(trail()).toEqual(['Batches', 'Agents'])
  unmount()

  const settings = render(<AppMasthead route="settings" status={null} />)
  expect(trail()).toEqual(['Batches', 'Agent settings'])
  settings.unmount()

  render(<AppMasthead route="settings/inventree" status={null} />)
  expect(trail()).toEqual(['Batches', 'Agent settings'])
})

test('the batch list names only Batches', () => {
  render(<AppMasthead route={undefined} status={null} />)

  expect(trail()).toEqual(['Batches'])
})
