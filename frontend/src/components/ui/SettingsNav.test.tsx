import { render, screen, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import { SettingsNav } from './SettingsNav'

const sections = [
  { id: 'agents', label: 'Agents', href: '#settings/agents', agent: true },
  { id: 'inventree', label: 'InvenTree', href: '#settings/inventree' },
  { id: 'appearance', label: 'Appearance', href: '#settings/appearance' },
]

test('links back to where Settings was opened, then lists the sections', () => {
  render(
    <SettingsNav
      back={{ label: 'Mouser 3381-22 › Processing', href: '#b1/processing/overview' }}
      sections={sections}
      current="inventree"
    />,
  )
  const nav = screen.getByRole('navigation', { name: 'Settings' })
  const links = within(nav).getAllByRole('link')

  expect(links[0]).toHaveAccessibleName('Back to Mouser 3381-22 › Processing')
  expect(links[0]).toHaveAttribute('href', '#b1/processing/overview')
  expect(within(nav).getByRole('heading', { name: 'Settings', level: 2 })).toBeInTheDocument()
  expect(links.slice(1).map((link) => link.textContent)).toEqual([
    'Agents',
    'InvenTree',
    'Appearance',
  ])
  expect(within(nav).getByRole('link', { name: 'InvenTree' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  expect(within(nav).getByRole('link', { name: 'Agents' })).not.toHaveAttribute('aria-current')
  expect(
    within(nav).getByRole('link', { name: 'Agents' }).querySelector('[data-ai-mark]'),
  ).not.toBeNull()
})

test("lists an open section's subsections under it and marks the one the route points at", () => {
  const withSubsections = [
    {
      ...sections[0],
      subsections: [
        { id: 'providers', label: 'Providers', href: '#settings/agents/providers' },
        { id: 'models', label: 'Provider and model per step', href: '#settings/agents/models' },
      ],
    },
    ...sections.slice(1),
  ]
  const { rerender } = render(
    <SettingsNav
      back={{ label: 'Batches', href: '#' }}
      sections={withSubsections}
      current="agents"
      currentSubsection="models"
    />,
  )
  const group = screen.getByLabelText('Agents sections')
  expect(within(group).getByRole('link', { name: 'Provider and model per step' })).toHaveAttribute(
    'aria-current',
    'location',
  )
  expect(within(group).getByRole('link', { name: 'Providers' })).not.toHaveAttribute('aria-current')

  rerender(
    <SettingsNav
      back={{ label: 'Batches', href: '#' }}
      sections={withSubsections}
      current="inventree"
    />,
  )
  expect(screen.queryByLabelText('Agents sections')).toBeNull()
})
