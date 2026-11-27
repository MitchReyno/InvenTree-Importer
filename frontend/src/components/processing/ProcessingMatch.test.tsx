import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { IntakeRequestError } from '@invimport/contracts/client'
import {
  validate,
  type BatchMatchDto,
  type CaptureSnapshotDto,
  type MatchCandidateDto,
  type MatchLotDto,
  type MatchOutcomeDto,
  type MatchQuestionDto,
  type ProcessingSnapshotDto,
} from '@invimport/contracts'
import type { ProcessingClient, ProcessingView } from '#/processing/types'
import { render } from '#/test/render'
import { ProcessingWorkspace } from './ProcessingWorkspace'

const id = (n: number) => `c0000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`

const batchId = id(1)
const resistor = id(101)
const capacitor = id(102)
const crystal = id(103)
const reel = id(104)
const tube = id(105)
const unsearched = id(106)
const resistorQuestion = id(201)
const asked = '2026-11-27T13:10:00Z'

const lot = (lotId: string, label: string, n: number) => ({
  id: lotId,
  label,
  revision: '1',
  contribution_key: id(400 + n),
  part_subject_id: null,
  quantity: { mode: 'inherit' as const },
  location: { mode: 'inherit' as const },
})

const batch: CaptureSnapshotDto = {
  id: batchId,
  source_id: id(2),
  title: 'Mouser 3381-22 + bench bag',
  revision: '8',
  archived: false,
  updated_at: '2026-11-27T13:00:00Z',
  actor_id: id(3),
  target_context_id: id(4),
  defaults: { quantity: { mode: 'unknown' }, location: { mode: 'clear' } },
  parts: [],
  notes: [],
  observations: [],
  lots: [
    lot(resistor, '10 kΩ resistor — packet B', 1),
    lot(capacitor, '100 nF capacitor reel', 2),
    lot(crystal, '16 MHz crystal HC-49', 3),
    lot(reel, 'Reel TK-1N4148', 4),
    lot(tube, 'LM358 tube', 5),
    lot(unsearched, 'Bench bag of spares', 6),
  ],
  cursor: { stream_id: id(5), sequence: '8' },
}
validate('CaptureSnapshot', batch)

/** A `/7` batch's Processing read: no jobs yet past Examine, and Match in place of Inventory. */
const processing: ProcessingSnapshotDto = {
  batch_id: batchId,
  capture_revision: '8',
  runner_status: 'fixture_only',
  cursor: batch.cursor,
  jobs: [],
  pipeline: 'match',
}
validate('ProcessingSnapshot', processing)

const mpn = (code: string, manufacturer: string) => ({
  kind: 'mpn' as const,
  mpn: code,
  manufacturer,
})

function part(
  pk: string,
  ipn: string,
  name: string,
  key: ReturnType<typeof mpn>,
): MatchCandidateDto {
  return {
    kind: 'part',
    part: { pk, name, ipn, has_image: true },
    verdict: 'exact',
    matched_by: [{ key, reason: 'mpn_and_manufacturer' }],
    missing: [
      { kind: 'datasheet' },
      { kind: 'parameter', template: '7' },
      { kind: 'parameter', template: '8' },
    ],
    parameters_known: true,
    stock: [],
  }
}

const resistorKey = mpn('RC0603FR-0710KL', 'Yageo')
const capacitorKey = mpn('CL10B104KB8NNNC', 'Samsung')
const res0144 = part('144', 'RES-0144', '10kΩ 0603 1%', resistorKey)
const cap0210 = part('210', 'CAP-0210', '100nF 0603 X7R', capacitorKey)

function matchLot(lotId: string, value: Partial<MatchLotDto>): MatchLotDto {
  return {
    lot_id: lotId,
    identity: { kind: 'examine', proposal_id: id(300) },
    state: 'clear',
    generation: '1',
    settled_generation: '1',
    keys: [],
    searchable: true,
    candidates: [],
    waits: [],
    ...value,
  }
}

const outcome = (
  lotId: string,
  value: Pick<MatchOutcomeDto, 'basis' | 'research' | 'images'>,
): MatchOutcomeDto => ({
  schema_version: 'bench-intake-match-outcome/1' as const,
  lot_id: lotId,
  revision: '1',
  ...value,
})

function question(
  questionId: string,
  lotId: string,
  value: Partial<MatchQuestionDto>,
): MatchQuestionDto {
  return {
    id: questionId,
    lot_id: lotId,
    revision: '3',
    state: 'open',
    kind: 'candidates',
    title: 'This looks like existing Part RES-0144',
    reason:
      'Match found these before any research or photos. Research and Images for this lot wait for your answer.\nRES-0144 · 10kΩ 0603 1% — InvenTree is missing a datasheet, 2 key parameters.',
    steps: [
      {
        id: 'match',
        prompt: 'What should happen?',
        assumption: 'Research and Images for this lot wait for your answer.',
        answer: {
          kind: 'choice',
          options: [
            {
              id: 'add_stock_1',
              label: 'Add stock to RES-0144',
              detail: 'No research · a stock photo',
            },
            {
              id: 'fill_gaps_1',
              label: "Add stock to RES-0144, and fill what's missing",
              detail: 'Research only what InvenTree lacks · a stock photo',
            },
            { id: 'new_part', label: "It's a new Part", detail: 'Full research and photos' },
            { id: 'already_imported', label: 'Already imported', detail: 'Leave this lot out' },
          ],
          other: true,
        },
      },
    ],
    keys: [resistorKey],
    candidates: [res0144],
    notes: [{ stage: 'examine', kind: 'relation', text: 'Same body marking as RES-0144’s photo.' }],
    asked_at: asked,
    ...value,
  }
}

/** The spec's batch mid-way: an exact match waiting, an add stock decision, a clear lot and more. */
function midway(): BatchMatchDto {
  const read: BatchMatchDto = {
    batch_id: batchId,
    capture_revision: '8',
    pipeline: 'match',
    lots: [
      matchLot(resistor, {
        state: 'question',
        keys: [resistorKey],
        verdict: 'exact',
        candidates: [res0144],
        waits: ['research', 'images'],
        question_id: resistorQuestion,
      }),
      matchLot(capacitor, {
        state: 'decided',
        keys: [capacitorKey],
        verdict: 'exact',
        candidates: [cap0210],
        target: { part_pk: '210', name: '100nF 0603 X7R' },
        decided_at: asked,
        outcome: outcome(capacitor, {
          basis: { kind: 'decision', decision: 'add_stock' },
          research: { stage: 'research', mode: 'skipped' },
          images: { stage: 'images', mode: 'stock', part_image: false },
        }),
      }),
      matchLot(crystal, {
        state: 'clear',
        keys: [mpn('ECS-160-20-4X', 'ECS')],
        verdict: 'none',
        outcome: outcome(crystal, {
          basis: { kind: 'clear' },
          research: { stage: 'research', mode: 'full' },
          images: { stage: 'images', mode: 'full' },
        }),
      }),
      matchLot(reel, {
        state: 'searching',
        generation: '2',
        keys: [mpn('1N4148W-7-F', 'Diodes Inc.')],
        waits: ['research', 'images'],
      }),
      matchLot(tube, { state: 'unavailable', keys: [mpn('LM358DR', 'Texas Instruments')] }),
    ],
    questions: [question(resistorQuestion, resistor, {})],
  }
  validate('BatchMatch', read)
  return read
}

function clientFor(read: BatchMatchDto, snapshot = processing) {
  return {
    read: vi.fn().mockResolvedValue(snapshot),
    start: vi.fn(),
    cancel: vi.fn(),
    answer: vi.fn(),
    match: vi.fn().mockResolvedValue(read),
    answerMatch: vi.fn().mockResolvedValue({
      batch_id: batchId,
      question_ids: [resistorQuestion],
      capture_revision: '8',
    }),
    answerMatches: vi.fn().mockResolvedValue({
      batch_id: batchId,
      question_ids: [resistorQuestion, id(202)],
      capture_revision: '8',
    }),
    checkMatches: vi.fn().mockResolvedValue({
      batch_id: batchId,
      lots: [{ lot_id: crystal, generation: '2' }],
    }),
    reopenMatch: vi.fn().mockResolvedValue({
      batch_id: batchId,
      lots: [{ lot_id: capacitor, generation: '1' }],
    }),
  } satisfies ProcessingClient
}

function mount(client: ProcessingClient, view: ProcessingView = 'match', questionId?: string) {
  const dirty = vi.fn()
  render(
    <ProcessingWorkspace
      batch={batch}
      client={client}
      view={view}
      questionId={questionId}
      navigate={vi.fn()}
      onDirtyChange={dirty}
      onSaved={vi.fn().mockResolvedValue(undefined)}
    />,
  )
  return { dirty }
}

async function row(name: string) {
  return within(await screen.findByRole('row', { name }))
}

/** A command that can be used now, once this mount's read has verified it. */
async function whenAvailable(control: HTMLElement) {
  await waitFor(() => expect(control).not.toHaveAttribute('aria-disabled'))
  expect(control).toBeEnabled()
}

describe('Processing › Match', () => {
  test('each row says what it matched by, its result and what runs in which mode', async () => {
    mount(clientFor(midway()))

    expect(
      await screen.findByRole('heading', { name: 'Match: is this already in InvenTree?' }),
    ).toBeInTheDocument()
    const exact = await row('10 kΩ resistor — packet B')
    expect(exact.getByText('RC0603FR-0710KL')).toBeInTheDocument()
    expect(exact.getByText('Exact: RES-0144')).toBeInTheDocument()
    expect(exact.getByText('Research and Images wait for you')).toBeInTheDocument()
    expect(exact.getByRole('link', { name: 'Answer: 10 kΩ resistor — packet B' })).toHaveAttribute(
      'href',
      `#${batchId}/processing/match/${resistorQuestion}`,
    )

    const decided = await row('100 nF capacitor reel')
    expect(decided.getByText('Add stock to CAP-0210')).toBeInTheDocument()
    expect(decided.getByText('Research skipped · stock photo')).toBeInTheDocument()
    expect(
      decided.getByRole('button', { name: 'Change: 100 nF capacitor reel' }),
    ).toBeInTheDocument()

    const clear = await row('16 MHz crystal HC-49')
    expect(clear.getByText('No match: new Part')).toBeInTheDocument()
    expect(clear.getByText('Research and Images in full')).toBeInTheDocument()
    expect(
      clear.getByRole('button', { name: 'Search again: 16 MHz crystal HC-49' }),
    ).toBeInTheDocument()

    const searching = await row('Reel TK-1N4148')
    expect(searching.getByText('Searching…')).toBeInTheDocument()
    expect(searching.getByText('Research and Images wait for the search')).toBeInTheDocument()
    expect(searching.queryByRole('button')).toBeNull()

    const unavailable = await row('LM358 tube')
    expect(unavailable.getByText('Couldn’t search')).toBeInTheDocument()
    expect(
      unavailable.getByText('Couldn’t search InvenTree; nothing starts until it can'),
    ).toBeInTheDocument()
    expect(
      unavailable.getByRole('button', { name: 'Search again: LM358 tube' }),
    ).toBeInTheDocument()

    expect((await row('Bench bag of spares')).getByText('Not searched yet')).toBeInTheDocument()

    const summary = within(screen.getByLabelText('Match summary'))
    expect(summary.getByText('1 need you')).toBeInTheDocument()
    expect(summary.getByText('1 existing Part')).toBeInTheDocument()
    expect(summary.getByText('1 new')).toBeInTheDocument()
    expect(summary.getByText('1 searching')).toBeInTheDocument()
    expect(summary.getByText('1 couldn’t search')).toBeInTheDocument()
  })

  test('answering sends the chosen option with the question’s revision', async () => {
    const user = userEvent.setup()
    const client = clientFor(midway())
    mount(client, 'match', resistorQuestion)

    const form = await screen.findByRole('form', {
      name: 'Match question: This looks like existing Part RES-0144',
    })
    // The candidates and the agents' notes sit above the options.
    expect(within(form).getByText('RES-0144')).toBeInTheDocument()
    expect(within(form).getByText('missing datasheet')).toBeInTheDocument()
    expect(within(form).getByText('missing 2 parameters')).toBeInTheDocument()
    expect(
      within(form).getByText('10 kΩ resistor — packet B · from Examine’s reading'),
    ).toBeInTheDocument()
    expect(within(form).getByText(/Same body marking as RES-0144/)).toBeInTheDocument()

    await user.click(
      within(form).getByRole('radio', { name: /^Add stock to RES-0144 No research/ }),
    )
    const send = within(form).getByRole('button', { name: 'Send answer' })
    await whenAvailable(send)
    await user.click(send)

    expect(client.answerMatch).toHaveBeenCalledWith(
      batchId,
      resistorQuestion,
      {
        expected_question_revision: '3',
        steps: [{ step_id: 'match', value: { kind: 'choice', option_id: 'add_stock_1' } }],
      },
      expect.any(String),
    )
  })

  test('Something else sends the operator’s words', async () => {
    const user = userEvent.setup()
    const client = clientFor(midway())
    mount(client, 'match', resistorQuestion)

    const form = await screen.findByRole('form', { name: /^Match question/ })
    await user.click(within(form).getByRole('radio', { name: /Something else/ }))
    await user.type(
      within(form).getByRole('textbox', { name: 'In your own words' }),
      'Same Part, but a different reel size',
    )
    const send = within(form).getByRole('button', { name: 'Send answer' })
    await whenAvailable(send)
    await user.click(send)

    expect(client.answerMatch).toHaveBeenCalledWith(
      batchId,
      resistorQuestion,
      {
        expected_question_revision: '3',
        steps: [
          {
            step_id: 'match',
            value: { kind: 'choice', other: 'Same Part, but a different reel size' },
          },
        ],
      },
      expect.any(String),
    )
  })

  test('a stale question’s refused answer keeps the draft and says it can’t be sent', async () => {
    const user = userEvent.setup()
    const client = clientFor(midway())
    client.answerMatch.mockRejectedValueOnce(new IntakeRequestError(409, 'stale_question'))
    const { dirty } = mount(client, 'match', resistorQuestion)

    const form = await screen.findByRole('form', { name: /^Match question/ })
    const option = within(form).getByRole('radio', { name: /It's a new Part/ })
    await user.click(option)
    const send = within(form).getByRole('button', { name: 'Send answer' })
    await whenAvailable(send)
    await user.click(send)

    expect(
      await within(form).findByText(/This question is superseded or its saved context changed/),
    ).toBeInTheDocument()
    expect(option).toBeChecked()
    expect(within(form).getByRole('button', { name: 'Send answer' })).toBeDisabled()
    expect(within(form).queryByText(/the server didn’t answer/)).toBeNull()
    expect(dirty).toHaveBeenLastCalledWith(true)
    expect(client.answerMatch).toHaveBeenCalledTimes(1)
  })

  test('an answer refused while Match searches again can be sent again once it finishes', async () => {
    const user = userEvent.setup()
    const client = clientFor(midway())
    client.answerMatch.mockRejectedValueOnce(new IntakeRequestError(409, 'match_waiting'))
    mount(client, 'match', resistorQuestion)

    const form = await screen.findByRole('form', { name: /^Match question/ })
    const option = within(form).getByRole('radio', { name: /It's a new Part/ })
    await user.click(option)
    const send = within(form).getByRole('button', { name: 'Send answer' })
    await whenAvailable(send)
    await user.click(send)

    expect(await within(form).findByText(/Match is searching again/)).toBeInTheDocument()
    expect(option).toBeChecked()
    await whenAvailable(within(form).getByRole('button', { name: 'Send answer' }))
    await user.click(within(form).getByRole('button', { name: 'Send answer' }))
    await waitFor(() => expect(client.answerMatch).toHaveBeenCalledTimes(2))
  })

  test('an answered question shows what was decided', async () => {
    const read = midway()
    read.questions[0] = {
      ...read.questions[0],
      state: 'answered',
      answer: { answered_at: asked, decision: 'add_stock', part_pk: '144' },
    }
    mount(clientFor(read), 'match', resistorQuestion)

    expect(await screen.findByText(/: Add stock to RES-0144/)).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: /^Match question/ })).toBeNull()
  })

  test('several exact matches can add stock to each in one answer', async () => {
    const user = userEvent.setup()
    const read = midway()
    const second = id(202)
    read.lots[1] = matchLot(capacitor, {
      state: 'question',
      keys: [capacitorKey],
      verdict: 'exact',
      candidates: [cap0210],
      waits: ['research', 'images'],
      question_id: second,
    })
    read.questions.push(
      question(second, capacitor, {
        revision: '5',
        title: 'This looks like existing Part CAP-0210',
        keys: [capacitorKey],
        candidates: [cap0210],
        notes: [],
      }),
    )
    validate('BatchMatch', read)
    const client = clientFor(read)
    mount(client)

    const card = within(await screen.findByRole('region', { name: 'Several exact matches' }))
    expect(card.getByText('10 kΩ resistor — packet B → RES-0144')).toBeInTheDocument()
    expect(card.getByText('100 nF capacitor reel → CAP-0210')).toBeInTheDocument()
    await user.click(card.getByRole('button', { name: 'Decide each' }))
    expect(card.getByRole('link', { name: /^100 nF capacitor reel:/ })).toHaveAttribute(
      'href',
      `#${batchId}/processing/match/${second}`,
    )

    const each = card.getByRole('button', { name: 'Add stock to each (photos only)' })
    await whenAvailable(each)
    await user.click(each)
    expect(client.answerMatches).toHaveBeenCalledWith(
      batchId,
      {
        answers: [
          {
            question_id: resistorQuestion,
            expected_question_revision: '3',
            option_id: 'add_stock_1',
          },
          { question_id: second, expected_question_revision: '5', option_id: 'add_stock_1' },
        ],
      },
      expect.any(String),
    )
  })

  test('a lot with two exact candidates is left out of adding stock to each', async () => {
    const read = midway()
    const second = id(202)
    read.lots[1] = matchLot(capacitor, {
      state: 'question',
      keys: [capacitorKey],
      verdict: 'exact',
      candidates: [cap0210],
      waits: ['research', 'images'],
      question_id: second,
    })
    read.questions.push(
      question(second, capacitor, {
        revision: '5',
        title: 'This looks like existing Part CAP-0210',
        keys: [capacitorKey],
        candidates: [cap0210, part('211', 'CAP-0211', '100nF 0603 X5R', capacitorKey)],
        notes: [],
      }),
    )
    validate('BatchMatch', read)
    mount(clientFor(read))

    await screen.findByRole('table')
    expect(screen.queryByRole('region', { name: 'Several exact matches' })).toBeNull()
  })

  test('Check InvenTree again, Search again and Change send their commands', async () => {
    const user = userEvent.setup()
    const client = clientFor(midway())
    mount(client)

    const all = await screen.findByRole('button', { name: 'Check InvenTree again' })
    await whenAvailable(all)
    await user.click(all)
    await waitFor(() =>
      expect(client.checkMatches).toHaveBeenCalledWith(
        batchId,
        { lot_ids: [resistor, capacitor, crystal, reel, tube] },
        expect.any(String),
      ),
    )

    const again = (await row('16 MHz crystal HC-49')).getByRole('button', {
      name: 'Search again: 16 MHz crystal HC-49',
    })
    await whenAvailable(again)
    await user.click(again)
    await waitFor(() =>
      expect(client.checkMatches).toHaveBeenLastCalledWith(
        batchId,
        { lot_ids: [crystal] },
        expect.any(String),
      ),
    )

    const change = (await row('100 nF capacitor reel')).getByRole('button', {
      name: 'Change: 100 nF capacitor reel',
    })
    await whenAvailable(change)
    await user.click(change)
    await waitFor(() =>
      expect(client.reopenMatch).toHaveBeenCalledWith(batchId, capacitor, expect.any(String)),
    )
  })

  test('a refused Change says Match is still waiting', async () => {
    const user = userEvent.setup()
    const client = clientFor(midway())
    client.reopenMatch.mockRejectedValueOnce(new IntakeRequestError(409, 'match_waiting'))
    mount(client)

    const change = (await row('100 nF capacitor reel')).getByRole('button', {
      name: 'Change: 100 nF capacitor reel',
    })
    await whenAvailable(change)
    await user.click(change)
    expect(
      await screen.findByText('Match is still searching or waiting for your answer for this lot.'),
    ).toBeInTheDocument()
  })

  describe('an original-contribution hit', () => {
    function hit(contribution: MatchQuestionDto['contribution']) {
      const read = midway()
      read.lots[4] = matchLot(tube, {
        state: 'question',
        verdict: 'duplicate',
        contribution,
        waits: ['research', 'images'],
        question_id: id(203),
      })
      read.questions.push(
        question(id(203), tube, {
          kind: 'contribution',
          title: 'This lot looks already imported',
          reason:
            'An earlier import round already approved this lot, so it must not become new stock.',
          keys: [],
          candidates: [],
          notes: [],
          contribution,
          steps: [
            {
              id: 'match',
              prompt: 'What should happen?',
              assumption: 'Research and Images for this lot wait for your answer.',
              answer: {
                kind: 'choice',
                options: [
                  {
                    id: 'already_imported',
                    label: 'Already imported',
                    detail: 'Leave this lot out',
                  },
                  { id: 'keep_held', label: 'Keep it held for now' },
                ],
                other: false,
              },
            },
          ],
        }),
      )
      validate('BatchMatch', read)
      return read
    }

    test('links the earlier run when the operator may read it', async () => {
      const run = id(600)
      const other = id(601)
      mount(
        clientFor(hit({ readable: true, run_id: run, batch_id: other, stock: 'not_created' })),
        'match',
        id(203),
      )

      const form = await screen.findByRole('form', {
        name: 'Match question: This lot looks already imported',
      })
      expect(within(form).getByText(/Its stock was never created\./)).toBeInTheDocument()
      expect(
        within(form).getByRole('link', { name: 'Open the earlier run in Changes › Added' }),
      ).toHaveAttribute('href', `#${other}/changes/added/${run}`)
      expect(within(form).queryByRole('radio', { name: /new Part/ })).toBeNull()
      const tubeRow = await row('LM358 tube')
      expect(tubeRow.getByText('Already imported?')).toBeInTheDocument()
      expect(tubeRow.getByText('Nothing runs until you answer')).toBeInTheDocument()
    })

    test('says only that it was already approved without run access', async () => {
      mount(clientFor(hit({ readable: false })), 'match', id(203))

      const form = await screen.findByRole('form', {
        name: 'Match question: This lot looks already imported',
      })
      expect(
        within(form).getByText('This lot’s contribution was already approved.'),
      ).toBeInTheDocument()
      expect(within(form).queryByRole('link', { name: /earlier run/ })).toBeNull()
      expect(within(form).queryByText(/stock was/)).toBeNull()
    })
  })
})

describe('Batches without the /7 pipeline keep Inventory', () => {
  test('a retained /6 batch keeps its Inventory step with its question answerable', async () => {
    const questionId = id(700)
    const jobId = id(701)
    const attemptId = id(702)
    const retained: ProcessingSnapshotDto = {
      ...processing,
      pipeline: undefined,
      jobs: [
        {
          id: jobId,
          subject_id: tube,
          stage: 'inventory',
          revision: '2',
          state: 'waiting_for_user',
          attempt_id: attemptId,
          input_sha256: 'a'.repeat(64),
          attempt_number: '1',
          qualification: 'fixture_only',
          proposals: [],
          questions: [
            {
              id: questionId,
              job_id: jobId,
              attempt_id: attemptId,
              input_sha256: 'a'.repeat(64),
              revision: '1',
              state: 'open',
              subject_id: tube,
              spec: {
                kind: 'clarification',
                prompt: 'Is the LM358 tube existing stock #1712?',
                reason: 'Stock #1712 has the same Part and bin.',
              },
            },
          ],
        },
      ],
    }
    delete retained.pipeline
    validate('ProcessingSnapshot', retained)
    const client = clientFor(midway(), retained)
    mount(client, 'inventory', questionId)

    expect(await screen.findByRole('heading', { name: 'Inventory' })).toBeInTheDocument()
    const answer = await screen.findByRole('form', { name: 'Pinned application question' })
    expect(within(answer).getByRole('textbox', { name: 'Clarification' })).toBeInTheDocument()
    expect(screen.queryByText(/Match in place of Inventory/)).toBeNull()
    expect(client.match).not.toHaveBeenCalled()
  })

  test('a batch with no lead keeps Inventory in the Overview and has no Match step', async () => {
    const noLead: ProcessingSnapshotDto = { ...processing }
    delete noLead.pipeline
    const client = clientFor(midway(), noLead)
    mount(client, 'overview')

    const steps = within(await screen.findByRole('list', { name: 'Steps' }))
    expect(steps.getByRole('link', { name: 'Inventory' })).toBeInTheDocument()
    expect(steps.queryByRole('link', { name: /^Match/ })).toBeNull()
  })

  test('a /7 batch shows Match in the Overview in place of Inventory', async () => {
    mount(clientFor(midway()), 'overview')

    const steps = within(await screen.findByRole('list', { name: 'Steps' }))
    expect(steps.getByRole('link', { name: 'Match' })).toHaveAttribute(
      'href',
      `#${batchId}/processing/match`,
    )
    expect(steps.queryByRole('link', { name: 'Inventory' })).toBeNull()
  })

  test('the Match route of a batch without it points to Inventory', async () => {
    const noLead: ProcessingSnapshotDto = { ...processing }
    delete noLead.pipeline
    const client = clientFor(midway(), noLead)
    mount(client, 'match')

    expect(await screen.findByText(/This batch has no Match step/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Inventory' })).toHaveAttribute(
      'href',
      `#${batchId}/processing/inventory`,
    )
    expect(client.match).not.toHaveBeenCalled()
  })

  test('the Inventory route of a /7 batch points to Match and shows no Inventory step', async () => {
    mount(clientFor(midway()), 'inventory')

    expect(
      await screen.findByText(/This batch’s pipeline has Match in place of Inventory/),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Match' })).toHaveAttribute(
      'href',
      `#${batchId}/processing/match`,
    )
    expect(screen.queryByRole('heading', { name: /Inventory/ })).toBeNull()
  })
})
