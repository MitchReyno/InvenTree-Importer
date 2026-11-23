import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test } from 'vitest'
import { validate, type ProcessingProposalDto } from '@invimport/contracts'
import { render } from '#/test/render'
import { setDebugMode } from '#/test/debug-mode'
import { ProcessingSources } from './ProcessingSources'

const id = (n: number) => `a0000000-0000-4000-8000-${n.toString().padStart(12, '0')}`

const noteSource = { kind: 'note' as const, note_id: id(1), text_sha256: 'c'.repeat(64) }
const datasheet = 'https://www.yageo.com/upload/media/product/RC0603.pdf'

const proposalV6: ProcessingProposalDto = {
  schema_version: 'bench-intake-proposal/6',
  subject_id: id(2),
  summary: 'A 0603 1k resistor reel from Yageo.',
  sources: [
    noteSource,
    {
      kind: 'web_page',
      url: datasheet,
      title: 'RC0603 datasheet',
      read_at: '2026-11-23T04:05:06.007Z',
    },
  ],
  relies_on: { fields: ['identity'], sources: [noteSource] },
}

afterEach(() => setDebugMode(false))

test('a stored /6 proposal shows its web page as a Web page chip marked agent-reported', async () => {
  const user = userEvent.setup()
  // The fixture is a proposal the Processing read would deliver.
  validate('ProcessingProposal', proposalV6)
  render(<ProcessingSources proposal={proposalV6} />)

  const pages = screen.getByRole('list', { name: 'Web pages the agent reported' })
  const chip = within(pages).getByRole('button', {
    name: 'Source: Web page, Agent-reported. Show details.',
  })
  await user.click(chip)
  expect(screen.getByText(/No copy is saved, so it is not verified/)).toBeInTheDocument()
  const link = screen.getByRole('link', { name: 'RC0603 datasheet' })
  expect(link).toHaveAttribute('href', datasheet)
  expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  // Internal IDs stay in debug mode, and the web page is never listed as retained evidence.
  expect(screen.queryByRole('list', { name: 'Retained candidate sources' })).toBeNull()
  setDebugMode(true)
  const retained = await screen.findByRole('list', { name: 'Retained candidate sources' })
  expect(within(retained).getAllByRole('listitem')).toHaveLength(1)
  expect(within(retained).getByText(id(1))).toBeInTheDocument()
})

test('a page without a title shows its address, and a /5 proposal shows no web page chip', () => {
  const untitled: ProcessingProposalDto = {
    ...proposalV6,
    sources: [noteSource, { kind: 'web_page', url: datasheet }],
  }
  const { unmount } = render(<ProcessingSources proposal={untitled} />)
  expect(screen.getByRole('button', { name: /Source: Web page/ })).toBeInTheDocument()
  unmount()

  render(
    <ProcessingSources
      proposal={{ ...proposalV6, schema_version: 'bench-intake-proposal/5', sources: [noteSource] }}
    />,
  )
  expect(screen.queryByRole('list', { name: 'Web pages the agent reported' })).toBeNull()
})
