import { render, screen, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { PipelineRows } from './ProcessingParts'

it('shows Research and Images side by side, then Inventory, with stale results called out', () => {
  render(
    <PipelineRows
      pipeline={{
        lead: { jobId: 'l', state: 'running' },
        lots: [
          {
            lotId: 'a',
            label: 'LED reel',
            cells: {
              research: { jobId: 'r', state: 'running', stale: 1, provisional: 0 },
              images: { jobId: 'i', state: 'ready', stale: 0, provisional: 2 },
              inventory: null,
            },
          },
        ],
      }}
    />,
  )
  expect(within(screen.getByLabelText('Examine · Whole batch')).getByText('Running')).toBeVisible()
  const row = screen.getByLabelText('Pipeline for LED reel')
  expect(within(row).getByLabelText('Research: Running')).toHaveTextContent('1 stale result')
  expect(within(row).getByLabelText('Images: Ready')).toHaveTextContent('2 provisional')
  expect(within(row).getByLabelText('Inventory: Not started')).toHaveTextContent('–Not started')
  expect(row).not.toHaveTextContent('∥')
})
