import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type {
  CaptureSnapshotDto,
  ManualPreviewDto,
  ManualRunDto,
  ManualWorkspaceDto,
} from '@invimport/contracts'
import { render } from '../../test/render'
import { Added } from './Added'

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`

const [lotA, lotB, lotC, lotD] = [101, 102, 103, 104].map(id)
const partSubject = id(10)
const batch = {
  id: id(1),
  archived: false,
  lots: [
    { id: lotA, label: 'Packet A', part_subject_id: partSubject },
    { id: lotB, label: 'Packet B', part_subject_id: partSubject },
    { id: lotC, label: 'Packet C', part_subject_id: partSubject },
    { id: lotD, label: 'Packet D', part_subject_id: partSubject },
  ],
} as unknown as CaptureSnapshotDto

const operation = (
  lot: string,
  certainty: 'none' | 'confirmed' | 'unknown',
  pk: string | null,
) => ({
  operation_key: lot,
  lot_id: lot,
  lot_label: batch.lots.find((value) => value.id === lot)!.label,
  quantity: '10',
  certainty,
  remote_pk: pk,
  recovery_allowed: false,
})

function run(n: number, value: Partial<ManualRunDto>): ManualRunDto {
  return {
    run_id: id(500 + n),
    approval_id: id(600 + n),
    preparation_id: id(700 + n),
    batch_id: batch.id,
    revision: '3',
    round_number: String(n),
    state: 'settled_complete',
    effect_certainty: 'confirmed',
    confirmed_stock_ids: [],
    attributed_stock_ids: [],
    cancellation_requested: false,
    dispatch_state: 'finished',
    operations: [],
    cursor: { stream_id: id(9), sequence: '1' },
    ...value,
  } as ManualRunDto
}

const confirmed = run(1, {
  confirmed_stock_ids: ['7101'],
  operations: [operation(lotA, 'confirmed', '7101')],
  part_outputs: [
    {
      operation_key: id(800),
      label: 'Carbon film resistor',
      usable: true,
      certainty: 'confirmed',
      remote_pks: ['77'],
      verification: null,
    },
  ] as ManualRunDto['part_outputs'],
})
const uncertain = run(2, {
  state: 'recovery_required',
  effect_certainty: 'unknown',
  attributed_stock_ids: ['7102'],
  operations: [operation(lotB, 'unknown', '7102')],
  supported_effects: [
    {
      operation_key: id(801),
      part_subject_id: partSubject,
      kind: 'parameter',
      label: 'Create mapped parameter',
      dependencies: [],
      inputs: {},
      certainty: 'unknown',
      remote_pks: [],
      verification: null,
      recovery_action: null,
      rejected: true,
    },
    // Not sent, because the round stopped first: nothing refused.
    {
      operation_key: id(803),
      part_subject_id: partSubject,
      kind: 'supplier',
      label: 'Create supplier relationship',
      dependencies: [],
      inputs: {},
      certainty: 'none',
      remote_pks: [],
      verification: null,
      recovery_action: null,
    },
    // As the server builds them: one create per stock operation, owned by the lot.
    {
      operation_key: lotB,
      part_subject_id: lotB,
      kind: 'create_stock',
      label: 'Create stock',
      dependencies: [],
      inputs: {},
      certainty: 'unknown',
      remote_pks: ['7102'],
      verification: null,
      recovery_action: null,
    },
    {
      operation_key: id(802),
      part_subject_id: partSubject,
      kind: 'manufacturer',
      label: 'Create manufacturer relationship',
      dependencies: [],
      inputs: {},
      certainty: 'none',
      remote_pks: [],
      verification: null,
      recovery_action: null,
    },
  ] as ManualRunDto['supported_effects'],
})

function workspace(
  runs: ManualRunDto[],
  preparations: ManualPreviewDto[] = [],
): ManualWorkspaceDto {
  return {
    lots: [
      {
        lot_id: lotA,
        reviewed: true,
        issues: [
          {
            code: 'original_contribution_already_approved',
            message: 'Added',
            lot_id: lotA,
            run_id: null,
          },
        ],
      },
      {
        lot_id: lotB,
        reviewed: true,
        issues: [
          {
            code: 'original_contribution_already_approved',
            message: 'Added',
            lot_id: lotB,
            run_id: null,
          },
        ],
      },
      { lot_id: lotC, reviewed: false, issues: [] },
    ],
    runs,
    preparations,
  } as unknown as ManualWorkspaceDto
}

function setup(runs: ManualRunDto[], preparations: ManualPreviewDto[] = []) {
  const command = vi.fn()
  const view = render(
    <Added
      batch={batch}
      workspace={workspace(runs, preparations)}
      busy={false}
      command={command}
      targetUrl="https://inventory.example.test/"
    />,
  )
  return { ...view, command }
}

describe('Added', () => {
  it('opens on an outcome strip that names the test target', () => {
    setup([confirmed, uncertain])
    const strip = screen.getByRole('region', { name: 'Outcome' })
    expect(strip).toHaveTextContent('1 stock item added')
    expect(strip).toHaveTextContent('1 being checked')
    expect(strip).toHaveTextContent('1 refused by InvenTree')
    expect(within(strip).getByText('Test InvenTree')).toBeVisible()

    const tone = (text: string) => within(strip).getByText(text).closest('[data-tone]')

    expect(tone('1 stock item added')).toHaveAttribute('data-tone', 'ok')
    expect(tone('1 being checked')).toHaveAttribute('data-tone', 'warn')
    expect(tone('1 refused by InvenTree')).toHaveAttribute('data-tone', 'bad')
  })

  it('links confirmed records into InvenTree', () => {
    setup([confirmed])
    expect(screen.getByRole('link', { name: 'Stock item 7101' })).toHaveAttribute(
      'href',
      'https://inventory.example.test/web/stock/item/7101/',
    )
    expect(screen.getByRole('link', { name: 'Part 77' })).toHaveAttribute(
      'href',
      'https://inventory.example.test/web/part/77/',
    )
  })

  it('checks an uncertain stock item by its import reference and never offers to create it again', () => {
    const { command, rerender } = setup([uncertain])
    const round = screen.getByRole('region', { name: 'Round 2' })
    expect(round).toHaveTextContent('Packet B is being checked by its import reference')
    expect(within(round).queryByRole('button', { name: /Packet B/ })).not.toBeInTheDocument()
    expect(command).not.toHaveBeenCalled()

    const resolved = run(2, {
      confirmed_stock_ids: ['7102'],
      operations: [operation(lotB, 'confirmed', '7102')],
    })
    rerender(
      <Added
        batch={batch}
        workspace={workspace([resolved])}
        busy={false}
        command={command}
        targetUrl={null}
      />,
    )
    expect(screen.getByRole('region', { name: 'Round 2' })).toHaveTextContent(
      'Stock item 7102 added',
    )
  })

  it('sends a value InvenTree did not take back to Review', () => {
    setup([uncertain])
    expect(
      screen.getByRole('link', { name: 'See in Review: Create mapped parameter' }),
    ).toHaveAttribute('href', `#${batch.id}/review/records/part/${partSubject}`)
  })

  it('links only a value InvenTree refused to Review, and says it cannot be sent yet', () => {
    setup([uncertain])
    expect(
      screen.getAllByRole('link', { name: /See in Review/ }).map((link) => link.textContent),
    ).toEqual(['See in Review: Create mapped parameter'])
    expect(screen.getByText(/InvenTree refused this value.*cannot be sent yet/)).toBeVisible()
    expect(screen.getByRole('region', { name: 'Outcome' })).toHaveTextContent(
      '1 refused by InvenTree',
    )
  })

  it('a round held only by a refusal says so, and a refused stock item is not being checked', () => {
    const held = run(4, {
      state: 'recovery_required',
      effect_certainty: 'unknown',
      operations: [operation(lotC, 'unknown', null)],
      supported_effects: [
        {
          operation_key: lotC,
          part_subject_id: lotC,
          kind: 'create_stock',
          label: 'Create stock',
          dependencies: [],
          inputs: {},
          certainty: 'unknown',
          remote_pks: [],
          verification: null,
          recovery_action: null,
          rejected: true,
        },
      ] as ManualRunDto['supported_effects'],
    })
    setup([held])
    const round = screen.getByRole('region', { name: 'Round 4' })
    expect(round).toHaveTextContent('InvenTree refused a value in this round')
    expect(round).not.toHaveTextContent('Stock may have been created')
    expect(round).toHaveTextContent('InvenTree refused this stock item, so it was not created.')
    expect(
      within(round).getByRole('link', { name: 'See in Review: Create stock' }),
    ).toHaveAttribute('href', `#${batch.id}/review/lots/${lotC}`)
    const strip = screen.getByRole('region', { name: 'Outcome' })
    expect(strip).toHaveTextContent('0 being checked')
    expect(strip).toHaveTextContent('1 refused by InvenTree')
    expect(screen.getByRole('list', { name: 'Activity' })).toHaveTextContent(
      'Round 4 approved: InvenTree refused a value',
    )
  })

  it('a refused new Part, location or attachment says so and links where it is set', () => {
    const effect = (n: number, kind: string, label: string) => ({
      operation_key: id(n),
      part_subject_id: kind === 'create_location' ? id(40) : partSubject,
      kind,
      label,
      dependencies: [],
      inputs: {},
      certainty: 'unknown',
      remote_pks: [],
      verification: null,
      recovery_action: null,
      rejected: true,
    })

    const held = run(5, {
      state: 'recovery_required',
      effect_certainty: 'unknown',
      part_outputs: [
        {
          operation_key: id(810),
          label: 'Carbon film resistor',
          usable: false,
          certainty: 'unknown',
          remote_pks: [],
          verification: null,
        },
      ] as unknown as ManualRunDto['part_outputs'],
      supported_effects: [
        effect(810, 'create_part', 'Create one shared Part'),
        effect(811, 'create_location', 'Create new stock location'),
        effect(812, 'part_attachment', 'Attach selected file to Part'),
      ] as ManualRunDto['supported_effects'],
    })
    setup([held])
    const round = screen.getByRole('region', { name: 'Round 5' })
    expect(round).toHaveTextContent('InvenTree refused this Part, so it was not created.')
    expect(round).not.toHaveTextContent('Being checked')
    expect(
      within(round).getByRole('link', { name: 'See in Review: Create one shared Part' }),
    ).toHaveAttribute('href', `#${batch.id}/review/records/part/${partSubject}`)
    expect(
      within(round).getByRole('link', { name: 'See in Capture: Create new stock location' }),
    ).toHaveAttribute('href', `#${batch.id}/capture`)
    expect(
      within(round).getByRole('link', { name: 'See in Review: Attach selected file to Part' }),
    ).toHaveAttribute('href', `#${batch.id}/review/records/part/${partSubject}`)
  })

  it('puts rounds needing attention first, filters to them, and keeps batch context aside', async () => {
    const user = userEvent.setup()
    setup([confirmed, uncertain])

    const rounds = () =>
      screen.getAllByRole('heading', { name: /^Round \d/ }).map((heading) => heading.textContent)

    expect(rounds()[0]).toMatch(/^Round 2/)
    await user.click(screen.getByRole('button', { name: 'Needs attention, 1' }))
    expect(rounds()).toEqual([expect.stringMatching(/^Round 2/)])

    const aside = screen.getByRole('complementary', { name: 'Batch outcome' })
    expect(within(aside).getByRole('link', { name: /^Ready to add/ })).toHaveAttribute(
      'href',
      `#${batch.id}/changes/ready`,
    )
    const notIncluded = within(aside).getByRole('region', { name: 'Not included' })
    expect(
      within(notIncluded).getByRole('link', { name: 'Packet D' }).closest('li'),
    ).toHaveTextContent(/^Packet D\s*\S/)
  })

  it('counts a stopped round to resume and an attachment to repair as needing attention', async () => {
    const user = userEvent.setup()
    const stopped = run(3, {
      state: 'settled_incomplete',
      effect_certainty: 'confirmed',
      operations: [{ ...operation(lotA, 'none', null), recovery_allowed: true }],
    })
    const repair = run(4, {
      attachments: [
        {
          certainty: 'confirmed',
          verification: 'missing_or_changed',
          recovery_action: 'repair_attachment',
        },
      ] as never,
    })
    setup([confirmed, stopped, repair])
    await user.click(screen.getByRole('button', { name: 'Needs attention, 2' }))
    expect(
      screen.getAllByRole('heading', { name: /^Round \d/ }).map((heading) => heading.textContent),
    ).toEqual([expect.stringMatching(/^Round 3/), expect.stringMatching(/^Round 4/)])
  })

  it('lists pending changes, lots not included and the activity log', () => {
    const pending = {
      id: id(900),
      effects: [{ lot_id: lotC, lot_label: 'Packet C' }],
    } as unknown as ManualPreviewDto
    setup([confirmed, uncertain], [pending])
    expect(
      screen.getByRole('link', { name: 'Packet C, prepared and not yet approved' }),
    ).toHaveAttribute('href', `#${batch.id}/changes/ready/${id(900)}`)
    const notIncluded = screen.getByRole('region', { name: 'Not included' })
    expect(
      within(notIncluded)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Packet D'])
    expect(within(notIncluded).getByRole('link', { name: 'Packet D' })).toHaveAttribute(
      'href',
      `#${batch.id}/review/lots/${lotD}`,
    )
    const log = screen.getByRole('list', { name: 'Activity' })
    expect(
      within(log)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      expect.stringMatching(/Round 1 approved: 1 stock item added/),
      expect.stringMatching(/Round 2 approved: needs checking/),
    ])
  })

  it('gives each round in the activity log the time it was approved', () => {
    const at = (iso: string) =>
      new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

    setup([
      { ...confirmed, approved_at: '2026-11-08T09:42:00.000Z' },
      { ...uncertain, approved_at: '2026-11-08T10:05:00.000Z' },
    ])
    const log = screen.getByRole('list', { name: 'Activity' })
    expect(
      within(log)
        .getAllByRole('listitem')
        .map((item) => item.querySelector('time')?.textContent),
    ).toEqual([at('2026-11-08T09:42:00.000Z'), at('2026-11-08T10:05:00.000Z')])
    expect(log.querySelector('time')).toHaveAttribute('datetime', '2026-11-08T09:42:00.000Z')
    expect(screen.queryByText(/no times are kept/)).toBeNull()
  })

  it('says when nothing has been added yet', () => {
    setup([])
    expect(
      screen.getByText('Nothing has been added to InvenTree from this batch yet.'),
    ).toBeVisible()
  })
})
