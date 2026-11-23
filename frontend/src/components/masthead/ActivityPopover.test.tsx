import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { BatchAttentionDto, HeaderWorkDto } from '@invimport/contracts'
import { useServerScope } from '#/context'
import { freshReads } from '#/queries/fresh-reads'
import { serverQueryKey } from '#/queries/scope'
import { fixtureScope, render } from '#/test/render'
import type { AgentsRead } from '#/processing/types'
import { ActivityPopover } from './ActivityPopover'

type Session = HeaderWorkDto['active_sessions'][number]
type StepCounts = NonNullable<HeaderWorkDto['batch_steps']>[number]['steps']['examine']

const batch = 'b0000000-0000-4000-8000-000000000001'
const other = 'b0000000-0000-4000-8000-000000000002'
const none: StepCounts = {
  jobs: 0,
  ready: 0,
  running: 0,
  waiting: 0,
  queued: 0,
  questions: 0,
  failed: 0,
  ready_lots: 0,
}

function uuid(n: number) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}

function job(stage: string, state: HeaderWorkDto['work'][number]['state'], n: number) {
  return {
    kind: 'processing' as const,
    id: uuid(n),
    batch_id: batch,
    attempt_id: uuid(n),
    stage,
    state,
    input_current: true,
    occupies_lane: state === 'running',
    blocked_code: null,
    steps: [{ stage, state }],
    steps_complete: false,
  } as HeaderWorkDto['work'][number]
}

function session(stage: Session['stage'], n: number, overrides: Partial<Session> = {}): Session {
  return {
    attempt_id: uuid(n),
    batch_id: batch,
    job_id: uuid(n),
    stage,
    state: 'running',
    selection: null,
    actual_model: null,
    progress: 'responding',
    occupies_lane: true,
    session_state: 'running',
    latest_status: null,
    current: true,
    ...overrides,
  }
}

/** Examine waits on two questions, Research runs on 7 of 12, Images on 9 of 12, Inventory queued. */
function workingBatch(overrides: Partial<HeaderWorkDto> = {}): HeaderWorkDto {
  return {
    actor_id: fixtureScope.actorId,
    target_id: fixtureScope.targetId,
    target_context_id: fixtureScope.targetContextId,
    observed_at: new Date().toISOString(),
    work: [
      job('research', 'running', 1),
      job('research', 'running', 2),
      job('images', 'running', 3),
      job('inventory', 'queued', 4),
    ],
    active_sessions: [
      session('research', 1, {
        latest_status: { text: 'Reading the TI datasheet', at: '2026-11-23T02:30:00.000Z' },
      }),
      session('research', 2, {
        latest_status: { text: 'Checking the reel label', at: '2026-11-23T02:40:00.000Z' },
      }),
      session('images', 3, {
        latest_status: { text: 'Cropping the packet photo', at: '2026-11-23T02:35:00.000Z' },
      }),
    ],
    batch_steps: [
      {
        batch_id: batch,
        paused: false,
        lots: 12,
        steps: {
          examine: { ...none, jobs: 1, ready: 1, questions: 2 },
          research: { ...none, jobs: 12, ready: 7, running: 2, ready_lots: 7 },
          images: { ...none, jobs: 12, ready: 9, running: 1, ready_lots: 9 },
          inventory: { ...none, jobs: 1, queued: 1 },
        },
      },
    ],
    paused_batches: [],
    paused_truncated: false,
    work_truncated: false,
    sessions_truncated: false,
    lane_occupied: true,
    ...overrides,
  }
}

type PopoverOptions = {
  fresh?: boolean
  /** Whether the reads behind the bars started after the last live hint; follows `fresh` if unset. */
  moving?: boolean
  agents?: Partial<AgentsRead>
  attention?: BatchAttentionDto
  /** Answers the header work read; the first answer is `data`. */
  read?: () => Promise<HeaderWorkDto>
}

let invalidateWork: () => Promise<void> = async () => {}

let noteHint: () => void = () => {}

let cacheOther: (data: HeaderWorkDto) => Promise<unknown> = async () => undefined

/** The popover over a header work read held in the query cache, as the masthead holds it. */
function WithWorkRead({ data, options }: { data: HeaderWorkDto; options: PopoverOptions }) {
  const scope = useServerScope()
  const queryClient = useQueryClient()
  const key = serverQueryKey(scope, 'header-work', batch)
  const read = useQuery({
    queryKey: key,
    queryFn: freshReads(queryClient).track(key, options.read ?? (async () => data)),
  })
  invalidateWork = () => queryClient.invalidateQueries({ queryKey: key })
  noteHint = () => freshReads(queryClient).noteHint()
  // A read another header scope left in the cache, as after moving between pages.
  cacheOther = (other) => {
    const otherKey = serverQueryKey(scope, 'header-work', 'all')
    return queryClient.fetchQuery({
      queryKey: otherKey,
      queryFn: freshReads(queryClient).track(otherKey, async () => other),
    })
  }
  if (!read.data) {
    return null
  }

  return (
    <ActivityPopover
      data={data}
      batchId={batch}
      batchTitle="Heyyy"
      attention={options.attention}
      unavailable={false}
      fresh={options.fresh ?? !read.isError}
      moving={options.moving ?? options.fresh ?? true}
      countsFromAttention={options.attention !== undefined}
    />
  )
}

async function popover(data: HeaderWorkDto, options: PopoverOptions = {}) {
  const result = render(<WithWorkRead data={data} options={options} />, {
    clients: options.agents ? { agents: options.agents as AgentsRead } : {},
  })
  await screen.findAllByRole('region')
  return result
}

function rows(group: HTMLElement) {
  return within(within(group).getByRole('list', { name: 'Stages' })).getAllByRole('link')
}

describe('ActivityPopover stage rows', () => {
  it('shows one row per stage with its count, state and status line, each opening its step', async () => {
    await popover(workingBatch())
    const group = screen.getByRole('region', { name: 'Heyyy · Processing' })
    const links = rows(group)

    expect(links.map((link) => link.querySelector('span')?.textContent)).toEqual([
      'Examine · 12 lots formed · 2 questions · ?Waiting for you',
      'Research · 7 of 12 lots · ⟳2 working',
      'Images · 9 of 12 lots · ⟳1 working',
      'Inventory · 0 of 12 lots · …Queued',
    ])
    expect(links.map((link) => link.getAttribute('href'))).toEqual(
      ['examine', 'research', 'images', 'inventory'].map((step) => `#${batch}/processing/${step}`),
    )
    // Each row's status line: the stage's newest agent line, or a plain reason.
    expect(links[1]).toHaveTextContent('Checking the reel label')
    expect(links[2]).toHaveTextContent('Cropping the packet photo')
    expect(links[0]).toHaveTextContent('2 questions waiting for your answer')
  })

  it('gives a stage with no listed session a plain reason, not an older agent line', async () => {
    const data = workingBatch()
    // No lot has finished Images yet, so none can be past both Research and Images.
    data.batch_steps![0].steps.images = { ...none, jobs: 12, running: 1 }
    await popover(data)
    const inventory = rows(screen.getByRole('region', { name: 'Heyyy · Processing' }))[3]

    expect(inventory).toHaveTextContent('Starts when Research and Images finish a lot')
  })

  it('gives a finished stage whose cancelled attempt still holds a slot a reason, and shows the slot', async () => {
    const data = workingBatch({
      work: [job('research', 'cancelled', 1)],
      active_sessions: [
        session('research', 1, {
          state: 'cancelled',
          session_state: 'cancelled',
          latest_status: { text: 'Stopping mid-search', at: '2026-11-23T02:50:00.000Z' },
        }),
      ],
    })
    data.batch_steps![0].steps.research = { ...none, jobs: 12, ready: 12, ready_lots: 12 }
    await popover(data)
    const group = screen.getByRole('region', { name: 'Heyyy · Processing' })
    const research = rows(group)[1]

    expect(research).toHaveTextContent('Every lot is done')
    expect(research).not.toHaveTextContent('Stopping mid-search')
    expect(group).toHaveTextContent('Physical lane occupied')
  })

  it('shows a stage outside the bounded session list with a reason rather than an agent line', async () => {
    const data = workingBatch({ active_sessions: [], sessions_truncated: true })
    await popover(data)
    const research = rows(screen.getByRole('region', { name: 'Heyyy · Processing' }))[1]

    expect(research).toHaveTextContent('An agent is working on this step')
  })

  it('shows a stage the read does not count with its known state and no invented count', async () => {
    await popover(workingBatch({ batch_steps: [] }))
    const links = rows(screen.getByRole('region', { name: 'Heyyy · Processing' }))

    expect(links[1]).toHaveTextContent('Working')
    expect(links[1]).not.toHaveTextContent(/ of /)
    expect(links[1]).toHaveTextContent('Checking the reel label')
  })

  it('draws the rows still from a stale read, and animates only working stages from a fresh one', async () => {
    const { container, unmount } = await popover(workingBatch())

    const animated = () =>
      [...container.querySelectorAll('[data-animated="true"]')].map((node) =>
        node.getAttribute('data-state'),
      )

    expect(animated()).toEqual(['working', 'working'])
    unmount()
    const stale = await popover(workingBatch(), { fresh: false })
    expect(stale.container.querySelectorAll('[data-animated="true"]')).toHaveLength(0)
  })

  it('reads Examine waiting on questions as waiting for you with nothing animated', async () => {
    const data = workingBatch({
      work: [job('examine', 'waiting_for_user', 5)],
      active_sessions: [
        session('examine', 5, {
          state: 'waiting_for_user',
          session_state: 'waiting_input',
          occupies_lane: false,
        }),
      ],
      lane_occupied: false,
    })
    data.batch_steps![0].steps = {
      examine: { ...none, jobs: 1, waiting: 1, questions: 2 },
      research: none,
      images: none,
      inventory: none,
    }
    const { container } = await popover(data, {
      attention: {
        batch_id: batch,
        revision: '3',
        processing: {
          questions: 2,
          failed: 0,
          running: 0,
          lots: 12,
          paused: false,
          steps: data.batch_steps![0].steps,
        },
        review: { to_check: 0, changed_after_review: 0, needs_answer: 0, to_decide: 0, records: 0 },
        changes: { ready: 0, failed: 0, uncertain: 0, runs: 0 },
        items: [],
        items_truncated: false,
      },
    })

    expect(container.querySelector('[data-state="waiting_for_you"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-animated="true"]')).toHaveLength(0)
  })
})

describe('ActivityPopover stage rows for sessions alone', () => {
  it('gives a batch whose work was cut from the list its stage rows, from its sessions', async () => {
    await popover(
      workingBatch({
        work: [],
        batch_steps: [],
        active_sessions: [session('research', 1), session('images', 2, { current: false })],
        work_truncated: true,
      }),
    )
    const group = screen.getByRole('region', { name: 'Heyyy · Processing' })
    const links = rows(group)

    expect(links).toHaveLength(4)
    expect(links[1]).toHaveTextContent('Working')
    // An earlier attempt that is not its job's current one says nothing about its stage.
    expect(links[2]).toHaveTextContent('Not started')
    expect(links[1]).not.toHaveTextContent('of 12 lots')
  })
})

describe('ActivityPopover Resume', () => {
  it('offers Resume on a paused batch, keeps a running turn working, and resumes through the pause route', async () => {
    const user = userEvent.setup()
    const pause = vi.fn(async () => ({ batch_id: batch, paused: false }))
    const data = workingBatch({
      work: [job('research', 'running', 1)],
      // Research's turn still runs; no Images turn is running.
      active_sessions: [session('research', 1)],
      paused_batches: [{ batch_id: batch, title: 'Heyyy' }],
    })
    data.batch_steps![0].paused = true
    data.batch_steps![0].steps.research = { ...none, jobs: 12, running: 1, ready_lots: 7 }
    data.batch_steps![0].steps.images = { ...none, jobs: 12, ready: 6, ready_lots: 6 }
    await popover(data, { agents: { pause } })
    const group = screen.getByRole('region', { name: 'Heyyy · Processing' })
    const links = rows(group)

    expect(group).toHaveTextContent('No session starts new work until you resume.')
    expect(links[1]).toHaveTextContent('1 working')
    expect(links[2]).toHaveTextContent('Paused')
    expect(links[2]).toHaveTextContent('Paused at 6 of 12 lots')
    expect(group.querySelector('[data-state="paused"] i')).toHaveStyle({ width: '50%' })
    await user.click(within(group).getByRole('button', { name: 'Resume' }))
    await waitFor(() => expect(pause).toHaveBeenCalledWith(batch, false))
  })

  it('lists a batch paused with no jobs, the open one included, by its name', async () => {
    const data = workingBatch({
      work: [],
      active_sessions: [],
      batch_steps: [],
      lane_occupied: false,
      paused_batches: [
        { batch_id: batch, title: 'Heyyy' },
        { batch_id: other, title: 'Resistor tray' },
      ],
      paused_truncated: true,
    })
    await popover(data, { agents: { pause: vi.fn() } })

    for (const name of ['Heyyy · Processing', 'Resistor tray · Processing']) {
      const group = screen.getByRole('region', { name })
      expect(within(group).getByRole('button', { name: 'Resume' })).toBeEnabled()
    }
    expect(screen.getByText(/More batches are paused than are listed here/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Agents' })).toHaveAttribute('href', '#agents')
  })

  it('makes Resume unavailable while the work read is stale, and sends nothing', async () => {
    const user = userEvent.setup()
    const pause = vi.fn()
    const data = workingBatch({ paused_batches: [{ batch_id: batch, title: 'Heyyy' }] })
    data.batch_steps![0].paused = true
    await popover(data, { fresh: false, agents: { pause } })
    const group = screen.getByRole('region', { name: 'Heyyy · Processing' })
    const resume = within(group).getByRole('button', { name: 'Resume' })

    expect(resume).toBeDisabled()
    expect(group).toHaveTextContent('Resume waits for a current workflow read.')
    await user.click(resume)
    expect(pause).not.toHaveBeenCalled()
  })

  it('keeps Resume unavailable while a live update refresh is landing, and sends nothing', async () => {
    const user = userEvent.setup()
    const pause = vi.fn(async () => ({ batch_id: batch, paused: false }))
    const data = workingBatch({ paused_batches: [{ batch_id: batch, title: 'Heyyy' }] })
    data.batch_steps![0].paused = true

    let release: (value: HeaderWorkDto) => void = () => {}

    let reads = 0
    await popover(data, {
      agents: { pause },
      read: () => {
        reads += 1
        if (reads === 1) {
          return Promise.resolve(data)
        }
        return new Promise((resolve) => {
          release = resolve
        })
      },
    })
    const group = screen.getByRole('region', { name: 'Heyyy · Processing' })
    const resume = within(group).getByRole('button', { name: 'Resume' })
    await waitFor(() => expect(resume).not.toHaveAttribute('aria-disabled'))

    // A live hint arrives: the read shown started before it, so Resume waits.
    act(() => noteHint())
    expect(resume).toHaveAttribute('aria-disabled', 'true')
    expect(resume).toHaveAccessibleDescription('Updating…')
    await user.click(resume)
    expect(pause).not.toHaveBeenCalled()

    // The hint's refresh is held: still waiting until it lands.
    act(() => {
      void invalidateWork()
    })
    await waitFor(() => expect(reads).toBe(2))
    expect(resume).toHaveAttribute('aria-disabled', 'true')
    await act(async () => release(data))
    await waitFor(() => expect(resume).not.toHaveAttribute('aria-disabled'))
    await user.click(resume)
    await waitFor(() => expect(pause).toHaveBeenCalledWith(batch, false))
  })

  it('says a Resume whose reply was lost is unconfirmed, and reads the batch again', async () => {
    const user = userEvent.setup()
    const pause = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    const data = workingBatch({ paused_batches: [{ batch_id: batch, title: 'Heyyy' }] })
    data.batch_steps![0].paused = true
    const read = vi.fn(async () => data)
    await popover(data, { agents: { pause }, read })
    const group = screen.getByRole('region', { name: 'Heyyy · Processing' })

    await user.click(within(group).getByRole('button', { name: 'Resume' }))

    expect(
      await within(group).findByText(
        "Resume wasn't confirmed; the batch shows as paused until the next read says otherwise.",
      ),
    ).toBeInTheDocument()
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
  })

  it('waits only on the work read it shows, not one another page left in the cache', async () => {
    const user = userEvent.setup()
    const pause = vi.fn(async () => ({ batch_id: batch, paused: false }))
    const data = workingBatch({ paused_batches: [{ batch_id: batch, title: 'Heyyy' }] })
    data.batch_steps![0].paused = true
    await popover(data, { agents: { pause } })
    await act(async () => {
      await cacheOther(data)
    })
    const group = screen.getByRole('region', { name: 'Heyyy · Processing' })
    const resume = within(group).getByRole('button', { name: 'Resume' })

    act(() => noteHint())
    expect(resume).toHaveAttribute('aria-disabled', 'true')
    // Only the shown read refreshes; the other page's read stays older than the hint.
    await act(async () => {
      await invalidateWork()
    })
    await waitFor(() => expect(resume).not.toHaveAttribute('aria-disabled'))
    await user.click(resume)
    await waitFor(() => expect(pause).toHaveBeenCalledWith(batch, false))
  })

  it('keeps saying a lost Resume is unconfirmed when the read after it also fails', async () => {
    const user = userEvent.setup()
    const pause = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    const data = workingBatch({ paused_batches: [{ batch_id: batch, title: 'Heyyy' }] })
    data.batch_steps![0].paused = true
    let reads = 0
    await popover(data, {
      agents: { pause },
      read: async () => {
        reads += 1
        if (reads > 1) {
          throw new Error('work_read_failed')
        }
        return data
      },
    })
    const group = screen.getByRole('region', { name: 'Heyyy · Processing' })

    await user.click(within(group).getByRole('button', { name: 'Resume' }))

    await waitFor(() =>
      expect(group).toHaveTextContent('Resume waits for a current workflow read.'),
    )
    expect(within(group).getByRole('alert')).toHaveTextContent("Resume wasn't confirmed")
  })
})
