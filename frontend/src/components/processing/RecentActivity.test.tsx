import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { validate, type BatchActivityEntryDto } from '@invimport/contracts'
import { H, agent, at, input, observation, proposal, question } from '#/test/session-history'
import { RecentActivity } from './RecentActivity'

type Entry = BatchActivityEntryDto['entry']

function item(entry: Entry, overrides: Partial<BatchActivityEntryDto> = {}): BatchActivityEntryDto {
  return {
    job_id: H.job,
    stage: 'research',
    subject_id: H.lot,
    entry,
    agent_note: { text: 'no public datasheet found', at: at(20) },
    ...overrides,
  }
}

function show(entries: BatchActivityEntryDto[]) {
  validate('BatchActivity', { entries })
  render(<RecentActivity batchId={H.batch} entries={entries} />)
  return screen.getByRole('list', { name: 'Recent activity' })
}

const lotLink = { kind: 'lot' as const, lot_id: H.lot, label: 'GE S2CN1 diodes' }

describe('recent activity', () => {
  it('leads with what the app recorded, linked to its lot, with the agent’s note muted', () => {
    const [proposed] = proposal(3, 10, { lotLink })
    const list = show([item(proposed)])
    const row = within(list).getByRole('listitem')

    expect(row).toHaveTextContent('Research proposed an identity for GE S2CN1 diodes')
    expect(within(row).getByRole('link', { name: 'GE S2CN1 diodes' })).toHaveAttribute(
      'href',
      expect.stringContaining(H.lot),
    )
    expect(within(row).getByText('Agent: no public datasheet found')).toBeVisible()
    // The app's own words carry no internal IDs.
    expect(row.textContent).not.toContain(H.proposal)
  })

  it('names a formed lot, an answer and a question in the app’s words', () => {
    const formed = agent(
      2,
      8,
      {
        kind: 'lot',
        lot: null,
        current: true,
        outcome: 'formed',
        separation_reason: null,
        not_retained: ['separation_reason'],
      },
      { summary: 'Formed GE S2CN1 diodes', links: [lotLink] },
    )
    const answered = input(
      4,
      12,
      {
        kind: 'answer',
        answer: {
          question_id: H.question,
          answer_id: H.inboxItem,
          value: { kind: 'quantity', value: '25', basis: 'counted' },
        },
        effects: [],
      },
      { summary: 'You answered: 25 counted', links: [lotLink] },
    )
    const asked = question(5, 14)
    const list = show([
      item(asked, { stage: 'examine', subject_id: null, agent_note: null }),
      item(answered),
      item(formed, { stage: 'examine', subject_id: null }),
    ])
    const rows = within(list).getAllByRole('listitem')

    expect(rows[0]).toHaveTextContent(/^Examine asked/)
    expect(within(rows[0]).queryByText(/^Agent:/)).not.toBeInTheDocument()
    expect(rows[1]).toHaveTextContent('You answered 25 counted for GE S2CN1 diodes')
    expect(rows[2]).toHaveTextContent('Examine formed GE S2CN1 diodes')
  })

  it('links an observation made before any lot to Capture', () => {
    const observed = observation(1, 5, { photo: 'Bench bag spill' })
    const list = show([
      item(
        {
          ...observed,
          links: [
            {
              kind: 'capture_evidence',
              evidence_id: H.evidence,
              version_id: H.version,
              page: 1,
              label: 'Bench bag spill',
            },
            { kind: 'map', observation_id: H.observation },
          ],
        },
        { stage: 'examine', subject_id: null },
      ),
    ])
    const row = within(list).getByRole('listitem')

    expect(row).toHaveTextContent('Examine recorded an observation in Bench bag spill')
    expect(within(row).getByRole('link', { name: 'Bench bag spill' })).toHaveAttribute(
      'href',
      expect.stringContaining('capture'),
    )
  })

  it('says when there is no activity yet, while it loads, and when it can’t be read', () => {
    const { rerender } = render(<RecentActivity batchId={H.batch} entries={[]} />)
    expect(screen.getByText('No agent activity yet.')).toBeVisible()

    rerender(<RecentActivity batchId={H.batch} />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading')

    rerender(<RecentActivity batchId={H.batch} failed />)
    expect(screen.getByText('Recent activity couldn’t be loaded.')).toBeVisible()
  })
})
