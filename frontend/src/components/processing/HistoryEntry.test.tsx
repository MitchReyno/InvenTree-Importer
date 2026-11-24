import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test } from 'vitest'
import type { CatalogueProposalDto, SessionHistoryEntryDto } from '@invimport/contracts'
import { render } from '#/test/render'
import { setDebugMode } from '#/test/debug-mode'
import { drawerItems } from '#/processing/session-history'
import {
  H,
  agent,
  citedPhoto,
  history,
  withCatalogue,
  input,
  observation,
  photoView,
  proposal,
  question,
  status,
} from '#/test/session-history'
import { SessionConversation } from './SessionConversation'

const context = { batchId: H.batch, jobId: H.job, step: 'research' as const }

afterEach(() => setDebugMode(false))

function show(entries: SessionHistoryEntryDto[]) {
  render(
    <SessionConversation
      label="Session history"
      items={drawerItems(entries)}
      context={context}
      working={false}
    />,
  )
  return screen.getByRole('list', { name: 'Session history' })
}

async function expand(name: string | RegExp) {
  const summary = screen.getByText(name, { selector: 'summary *, summary' })
  await userEvent.click(summary)
  return summary.closest('details')!
}

test('a status line stays one line, with nothing to expand', () => {
  const list = show([status(1, 1, 'Checking packet A')])

  expect(within(list).getByText('Checking packet A')).toBeVisible()
  expect(list.querySelector('details')).toBeNull()
})

test('an observation expands to its crop, reading and count, linking to Capture and the map', async () => {
  show([observation(1, 1)])
  const details = await expand('Recorded an observation in Bench bag spill')

  expect(within(details).getByRole('img', { name: /Crop of the observation/ })).toHaveAttribute(
    'src',
    `/api/v1/batches/${H.batch}/media/observations/${H.observation}/crop`,
  )
  expect(details).toHaveTextContent('“1N4148 ~200?”')
  expect(details).toHaveTextContent('9 visible')
  expect(details).toHaveTextContent('Current values')
  expect(
    within(details).getByRole('button', { name: /Source: Examine · Handwriting/ }),
  ).toBeInTheDocument()
  expect(
    within(details).getByRole('link', { name: 'Open Bench bag spill in Capture' }),
  ).toHaveAttribute('href', `#${H.batch}/capture/${H.evidence}`)
  expect(within(details).getByRole('link', { name: 'Show on the map' })).toHaveAttribute(
    'href',
    `#${H.batch}/review/map`,
  )
})

test('a formed lot expands to its current observations, quantity and why it is kept apart', async () => {
  const obs = observation(1, 1).details
  show([
    agent(
      2,
      2,
      {
        kind: 'lot',
        lot: {
          id: H.lot,
          label: '10 kΩ resistor — packet B',
          retired: false,
          operator_edited: false,
          observations: obs.kind === 'observation' && obs.current ? [obs.current] : [],
          selected_quantity: { mode: 'inherit' },
          estimate: { quantity: '380', basis: 'estimated from the reel width' },
          part_subject_id: null,
        },
        current: true,
        outcome: 'formed',
        separation_reason: 'same MPN as packet A, date code 2407 vs 2341',
        not_retained: [],
      },
      {
        summary: 'Formed 10 kΩ resistor — packet B',
        links: [
          { kind: 'lot', lot_id: H.lot, label: '10 kΩ resistor — packet B' },
          { kind: 'map', lot_id: H.lot },
        ],
      },
    ),
  ])
  const details = await expand('Formed 10 kΩ resistor — packet B')

  expect(details).toHaveTextContent('Current values')
  expect(details).toHaveTextContent('380 · estimated')
  expect(details).toHaveTextContent('estimated from the reel width')
  expect(details).toHaveTextContent('Kept apart: same MPN as packet A, date code 2407 vs 2341')
  expect(details).toHaveTextContent('“1N4148 ~200?”')
  expect(
    within(details).getByRole('link', { name: 'Open 10 kΩ resistor — packet B in Review' }),
  ).toHaveAttribute('href', `#${H.batch}/review/lots/${H.lot}`)
  expect(within(details).getByRole('link', { name: 'Show on the map' })).toBeInTheDocument()
})

test('a lot entry without a reason says it was not recorded', async () => {
  show([
    agent(
      2,
      2,
      {
        kind: 'lot',
        lot: null,
        current: true,
        outcome: null,
        separation_reason: null,
        not_retained: ['separation_reason'],
      },
      { summary: 'Proposed a lot' },
    ),
  ])
  const details = await expand('Proposed a lot')

  expect(details).toHaveTextContent('Why it is kept apart was not recorded.')
})

test('a regroup lists each move between lots, and an older one its destinations', async () => {
  const lotB = '21000000-0000-4000-8000-000000000002'
  show([
    agent(
      3,
      3,
      { kind: 'regroup', lot_ids: [lotB] },
      {
        summary: 'Regrouped observations into Green LED',
        links: [{ kind: 'lot', lot_id: lotB, label: 'Green LED' }],
      },
    ),
    status(2, 2, 'between'),
    agent(
      1,
      1,
      {
        kind: 'regroup',
        moves: [
          {
            observation_id: H.observation,
            from_lot_id: H.lot,
            to_lot_id: lotB,
            outcome: 'applied',
          },
          { observation_id: H.part, from_lot_id: null, to_lot_id: lotB, outcome: 'suggested' },
        ],
        lot_ids: [lotB],
      },
      {
        summary: 'Moved 1 observation, suggested moving 1 observation',
        links: [
          { kind: 'lot', lot_id: H.lot, label: 'Packet A' },
          { kind: 'lot', lot_id: lotB, label: 'Green LED' },
        ],
      },
    ),
  ])
  const moves = await expand('Moved 1 observation, suggested moving 1 observation')
  // Each observation is told apart, with where it came from, where it went and the outcome.
  expect(moves).toHaveTextContent('Observation 1: from Packet A to Green LED, moved')
  expect(moves).toHaveTextContent(
    'Observation 2: from no lot to Green LED, only suggested, since you edited it',
  )
  expect(within(moves).getAllByRole('link', { name: 'Show on the map' })).toHaveLength(2)
  expect(within(moves).getByRole('link', { name: 'Open Packet A in Review' })).toBeInTheDocument()

  const older = await expand('Regrouped observations into Green LED')
  expect(older).toHaveTextContent('Moved into Green LED')
})

test('a proposal expands to its sources, provisional questions and links', async () => {
  show(
    proposal(1, 1, {
      currentness: { state: 'provisional', question_ids: [H.question] },
    }).slice(0, 1),
  )
  const details = await expand('Proposed ATmega328P-AU · provisional')

  expect(details).toHaveTextContent('Provisional until you answer')
  expect(
    within(details).getByRole('button', {
      name: 'Source: Web page, Agent-reported. Show details.',
    }),
  ).toBeInTheDocument()
  expect(
    within(details).getByRole('link', { name: 'Question: Which ATmega328P variant is this?' }),
  ).toHaveAttribute('href', `#${H.batch}/processing/research/${H.question}`)
  expect(
    within(details).getByRole('link', { name: 'Open ATmega328P in Review' }),
  ).toBeInTheDocument()
  const page = within(details).getByRole('link', { name: /ww1\.microchip\.com/ })
  expect(page).toHaveAttribute('target', '_blank')
  expect(page.getAttribute('rel')).toContain('noreferrer')
  expect(page).toHaveTextContent('agent-reported')
})

test('a named Part links to Records', async () => {
  const [entry] = proposal(1, 1)
  show([
    {
      ...entry,
      links: [...entry.links, { kind: 'record', part_subject_id: H.part, label: 'ATmega328P-AU' }],
    },
  ])
  const details = await expand('Proposed ATmega328P-AU')

  expect(
    within(details).getByRole('link', { name: 'Open ATmega328P-AU in Records' }),
  ).toHaveAttribute('href', `#${H.batch}/review/records/part/${H.part}`)
})

test('a question expands to its steps and assumptions, linking to Answer and the lot', async () => {
  show([question(1, 1)])
  const details = await expand('Asked: Which ATmega328P variant is this?')

  expect(details).toHaveTextContent('Which ATmega328P variant is this?')
  expect(details).toHaveTextContent('Assuming ATmega328P-AU until you answer')
  expect(details).toHaveTextContent('Open')
  expect(
    within(details).getByRole('link', { name: 'Question: Which ATmega328P variant is this?' }),
  ).toBeInTheDocument()
  expect(
    within(details).getByRole('link', { name: 'Open ATmega328P in Review' }),
  ).toBeInTheDocument()
})

test('your answer shows as your bubble with what it changed and its lot', () => {
  show([
    input(
      4,
      4,
      {
        kind: 'answer',
        answer: {
          question_id: H.question,
          answer_id: H.inboxItem,
          steps: [
            { step_id: 'same', value: { kind: 'choice', option_id: 'yes', label: 'same Part' } },
            { step_id: 'count', value: { kind: 'number', value: '380', basis: 'estimated' } },
          ],
        },
        effects: [
          { kind: 'quantity', lot_id: H.lot, value: '380', basis: 'estimated' },
          { kind: 'note', subject_id: H.lot },
        ],
      },
      {
        summary: 'You answered: same Part · 380 estimated',
        links: [{ kind: 'lot', lot_id: H.lot, label: 'Packet A' }],
      },
    ),
  ])
  // An answer is the operator's bubble, with what it changed beside its time.
  const bubble = screen.getByText('same Part · 380 estimated').closest('[data-mine]') as HTMLElement
  expect(bubble).toHaveTextContent('You')
  expect(bubble).toHaveTextContent('Lot quantity set to 380 (estimated) · note added')
  expect(within(bubble).getByRole('link', { name: 'Open Packet A in Review' })).toBeInTheDocument()
})

test('an input the session has not read says so, and an app notice is marked as the app’s', () => {
  const list = show([
    input(
      2,
      2,
      { kind: 'revision', fields: ['identity'], reason: 'Top marking reads ATMEGA328PB' },
      { who: 'app', read: false, summary: 'Revision: Top marking reads ATMEGA328PB' },
    ),
  ])

  expect(list).toHaveTextContent('App')
  expect(list).toHaveTextContent('Not read yet')
})

test('a photo view expands to the recut region with its delivered size, linking to Capture', async () => {
  setDebugMode(true)
  // The drawer folds photo views; the session page renders each one.
  render(
    <SessionConversation
      working={false}
      label="Page history"
      items={[{ kind: 'entry', id: 'x', summary: 'x', entry: photoView(1, 1) }]}
      context={context}
    />,
  )
  const details = await expand('Prepared part of MCU close-up for the agent')

  expect(within(details).getByRole('img', { name: /Region sent to the agent/ })).toHaveAttribute(
    'src',
    `/api/v1/batches/${H.batch}/processing/sessions/${H.job}/photo-views/${H.attempt}/1/crop`,
  )
  expect(details).toHaveTextContent('Sent 1024 × 768')
  expect(details).toHaveTextContent('region 1024 × 768 at 100, 200')
  expect(details).toHaveTextContent('d'.repeat(64))
  expect(
    within(details).getByRole('link', { name: 'Open MCU close-up in Capture' }),
  ).toBeInTheDocument()
})

test('a retired lot or removed photo shows what happened instead of a link', async () => {
  show([
    {
      ...observation(1, 1),
      links: [{ kind: 'gone', target: 'evidence', label: 'Photo removed' }],
    },
    {
      ...proposal(2, 2)[0],
      links: [{ kind: 'gone', target: 'lot', label: 'Lot retired' }],
    },
  ])
  const lot = await expand('Proposed ATmega328P-AU')
  expect(lot).toHaveTextContent('Lot retired')
  expect(within(lot).queryByRole('link', { name: /in Review/ })).toBeNull()
  // The details of what the agent did stay.
  expect(lot).toHaveTextContent('Current')

  const photo = await expand('Recorded an observation in Bench bag spill')
  expect(photo).toHaveTextContent('Photo removed')
  expect(within(photo).queryByRole('link', { name: /in Capture/ })).toBeNull()
})

test('a group expands to each of its entries', async () => {
  show([observation(2, 2, { id: H.part, text: 'LED tape' }), observation(1, 1)])
  const group = await expand('Recorded 2 observations in Bench bag spill')

  expect(within(group).getAllByRole('listitem')).toHaveLength(2)
  expect(group).toHaveTextContent('LED tape')
})

test('the drawer folds photo views and web reads into a line linking to the full session', () => {
  const list = show([photoView(3, 3), ...proposal(2, 2).slice(1)])

  expect(list).toHaveTextContent('Read 1 web page · viewed 1 photo')
  expect(within(list).getByRole('link', { name: 'see full session' })).toHaveAttribute(
    'href',
    `#${H.batch}/processing/research/sessions/${H.job}`,
  )
})

test('a proposal’s structured values show with chips listing their own sources, and what it relies on', async () => {
  const user = userEvent.setup()
  const entry = withCatalogue(proposal(1, 1)[0], {
    category: null,
    parameters: [],
    manufacturer: {
      company: {
        choice: 'proposed_new',
        name: 'Microchip',
        reason: 'Named on the datasheet.',
        sources: [citedPhoto],
      },
      mpn: 'ATmega328P-AU',
      sources: [citedPhoto],
      source_kind: 'label',
      agreement: 'read',
    },
    supplier: null,
    description: null,
  })
  show(history([entry]).entries)
  const expanded = await expand('Proposed ATmega328P-AU')

  expect(expanded).toHaveTextContent('Microchip (new)')
  expect(expanded).toHaveTextContent('ATmega328P-AU')
  expect(expanded).toHaveTextContent('Relies on identity, from:')
  await user.click(
    within(expanded).getByRole('button', { name: 'Source: Agent · Label, Read. Show details.' }),
  )
  expect(
    screen.getAllByRole('link', { name: 'Open MCU close-up in Capture' }).length,
  ).toBeGreaterThan(1)
})

test('an existing company or category is named by its InvenTree record, a new category by name', async () => {
  const reference = <M extends 'company' | 'category'>(model: M, pk: string) => ({
    observation_id: H.failure,
    target_context_id: H.instruction,
    model,
    pk,
  })

  const catalogue = (category: CatalogueProposalDto['category']): CatalogueProposalDto => ({
    category,
    parameters: [],
    manufacturer: {
      company: { choice: 'existing', reference: reference('company', '42'), sources: [citedPhoto] },
      mpn: 'ATmega328P-AU',
      sources: [citedPhoto],
    },
    supplier: null,
    description: null,
  })

  const [base] = proposal(1, 1)
  const existing = withCatalogue(
    base,
    catalogue({ choice: 'existing', reference: reference('category', '7'), sources: [citedPhoto] }),
    { summary: 'Proposed with an existing category' },
  )
  const created = withCatalogue(
    base,
    catalogue({
      choice: 'proposed_new',
      name: 'Microcontrollers',
      reason: 'None fits.',
      sources: [citedPhoto],
    }),
    { id: `outbox:${H.attempt}:2`, summary: 'Proposed with a new category' },
  )
  // Validated as the history read would send them.
  render(
    <SessionConversation
      working={false}
      label="Catalogue choices"
      items={history([created, existing]).entries.map((entry) => ({
        kind: 'entry' as const,
        id: entry.id,
        summary: entry.summary,
        entry,
      }))}
      context={context}
    />,
  )
  const shownExisting = await expand('Proposed with an existing category')
  expect(shownExisting).toHaveTextContent('Existing InvenTree company #42')
  expect(shownExisting).toHaveTextContent('Existing InvenTree category #7')
  // Manufacturer, MPN and category each carry their own source chip.
  expect(
    within(shownExisting).getAllByRole('button', { name: /^Source: Agent, Proposed/ }),
  ).toHaveLength(3)
  const shownCreated = await expand('Proposed with a new category')
  expect(shownCreated).toHaveTextContent('Microcontrollers (new)')
})
