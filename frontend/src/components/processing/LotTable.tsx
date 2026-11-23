import styled from 'styled-components'
import { DataTable, linkTouchArea, StatePill, WORK_STATE, type DataRow } from '#/components/ui'
import { lotFocusHref } from '#/navigation/batch-route'
import { LOT_STAGES, type LotSteps } from '#/processing/lot-steps'
import { radius } from '#/theme/generated/tokens'

const COLUMNS = [
  { id: 'lot', header: 'Lot' },
  ...LOT_STAGES.map(({ step, label }) => ({ id: step, header: label, nowrap: true })),
]

/** One row per live lot, with each per-lot step's state linking to that step with the lot in focus. */
export function LotTable({ batchId, lots }: { batchId: string; lots: LotSteps[] }) {
  const rows: DataRow[] = lots.map((lot) => ({
    id: lot.lotId,
    label: lot.label,
    cells: {
      lot: { value: lot.label, content: <LotName>{lot.label}</LotName> },
      ...Object.fromEntries(
        LOT_STAGES.map(({ step, label }) => {
          const { state } = lot.steps[step]
          return [
            step,
            {
              value: WORK_STATE[state].word,
              content: (
                <PillLink
                  href={lotFocusHref(batchId, step, lot.lotId)}
                  aria-label={`${label}: ${WORK_STATE[state].word}`}
                >
                  <StatePill state={state} />
                </PillLink>
              ),
            },
          ]
        }),
      ),
    },
  }))

  return <DataTable caption="Lots" columns={COLUMNS} rows={rows} />
}

/** At phone width the table scrolls sideways rather than squeezing the name a letter per line. */
const LotName = styled.span`
  display: block;
  min-width: 14ch;
`

const PillLink = styled.a`
  display: inline-flex;
  border-radius: ${radius.pill};
  text-decoration: none;
  ${linkTouchArea}
`
