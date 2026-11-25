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

  it('says a regroup only suggested its moves, linking the lot they would go to', () => {
    const lotB = {
      kind: 'lot' as const,
      lot_id: '20000000-0000-4000-8000-0000000000b2',
      label: 'Packet B',
    }
    const regrouped = agent(
      6,
      16,
      {
        kind: 'regroup',
        lot_ids: [lotB.lot_id],
        moves: [
          {
            observation_id: H.observation,
            from_lot_id: H.lot,
            to_lot_id: lotB.lot_id,
            outcome: 'suggested',
          },
        ],
      },
      { links: [lotLink, lotB] },
    )
    const row = within(show([item(regrouped, { stage: 'examine', subject_id: null })])).getByRole(
      'listitem',
    )

    expect(row).toHaveTextContent('Examine suggested moving 1 observation to Packet B')
    expect(row).not.toHaveTextContent('regrouped')
    expect(within(row).getByRole('link', { name: 'Packet B' })).toBeVisible()
  })

  it('names each destination of a regroup, mixed outcomes, and a destination no longer in Review', () => {
    const lot = (n: number, label: string) => ({
      kind: 'lot' as const,
      lot_id: `20000000-0000-4000-8000-00000000000${n}`,
      label,
    })

    const [b, c] = [lot(7, 'Packet B'), lot(8, 'Packet C')]

    const move = (to: string, outcome: 'applied' | 'suggested' | 'unchanged', n: number) => ({
      observation_id: `70000000-0000-4000-8000-00000000000${n}`,
      from_lot_id: H.lot,
      to_lot_id: to,
      outcome,
    })

    const regroup = (moves: ReturnType<typeof move>[], links: Entry['links']) =>
      agent(6, 16, { kind: 'regroup', lot_ids: [b.lot_id, c.lot_id], moves }, { links })

    const list = show([
      item(regroup([move(b.lot_id, 'applied', 1), move(c.lot_id, 'applied', 2)], [lotLink, b, c]), {
        stage: 'examine',
        subject_id: null,
      }),
      item(
        regroup([move(b.lot_id, 'applied', 3), move(c.lot_id, 'suggested', 4)], [lotLink, b, c]),
        { stage: 'examine', subject_id: null },
      ),
      // Packet B was retired since: its link is gone, and the source lot is not named instead.
      item(
        regroup(
          [move(b.lot_id, 'applied', 5)],
          [lotLink, { kind: 'gone', target: 'lot', label: 'Lot retired' }],
        ),
        { stage: 'examine', subject_id: null },
      ),
      item(
        regroup(
          [move(b.lot_id, 'applied', 6), move(c.lot_id, 'applied', 7), move(H.lot, 'unchanged', 8)],
          [lotLink, c],
        ),
        { stage: 'examine', subject_id: null },
      ),
    ])
    const rows = within(list).getAllByRole('listitem')

    expect(rows[0]).toHaveTextContent('Examine moved 2 observations to Packet B and Packet C')
    expect(rows[1]).toHaveTextContent(
      'Examine moved 1 observation to Packet B, and suggested moving 1 observation to Packet C',
    )
    expect(rows[2]).toHaveTextContent('Examine moved 1 observation to a lot no longer in Review')
    expect(within(rows[2]).queryByRole('link', { name: 'GE S2CN1 diodes' })).toBeNull()
    // A retired first destination doesn't hide a live second one.
    expect(rows[3]).toHaveTextContent(
      'Examine moved 2 observations to a lot no longer in Review and Packet C, and left 1 observation in place in GE S2CN1 diodes',
    )
    expect(within(rows[3]).getByRole('link', { name: 'Packet C' })).toBeVisible()
  })

  it('keeps an observation’s place on the map, and leads a whole-batch answer to its question', () => {
    const observed = observation(1, 5)
    const answered = input(
      4,
      12,
      {
        kind: 'answer',
        answer: {
          question_id: H.question,
          answer_id: H.inboxItem,
          value: { kind: 'clarification', text: 'One reel' },
        },
        effects: [],
      },
      {
        summary: 'You answered: One reel',
        links: [{ kind: 'question', question_id: H.question, label: 'Is this one reel?' }],
      },
    )
    const list = show([
      item(answered, { stage: 'examine', subject_id: null }),
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
    const [answerRow, observationRow] = within(list).getAllByRole('listitem')

    expect(within(answerRow).getByRole('link', { name: 'Is this one reel?' })).toBeVisible()
    expect(within(observationRow).getByRole('link', { name: 'Show on the map' })).toBeVisible()
  })

  it('keeps the last copy after a failed refresh, and says so', () => {
    const [proposed] = proposal(3, 10, { lotLink })
    render(<RecentActivity batchId={H.batch} entries={[item(proposed)]} failed />)

    expect(screen.getByRole('status')).toHaveTextContent(
      'Recent activity couldn’t be refreshed; showing the last copy.',
    )
    expect(screen.getByRole('list', { name: 'Recent activity' })).toHaveTextContent(
      'Research proposed an identity',
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
