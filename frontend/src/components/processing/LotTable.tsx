import styled from 'styled-components'
import { DataTable, linkTouchArea, StatePill, WORK_STATE, type DataRow } from '#/components/ui'
import { lotFocusHref } from '#/navigation/batch-route'
import { LOT_STAGES, type LotSteps } from '#/processing/lot-steps'
import { radius } from '#/theme/generated/tokens'

/**
 * One row per live lot, with each per-lot step's state linking to that step with the lot in focus.
 * A `/7` batch has no Inventory step, so its column is left out.
 */
export function LotTable({
  batchId,
  lots,
  inventory = true,
}: {
  batchId: string
  lots: LotSteps[]
  inventory?: boolean
}) {
  const stages = LOT_STAGES.filter(({ step }) => inventory || step !== 'inventory')
  const columns = [
    { id: 'lot', header: 'Lot' },
    ...stages.map(({ step, label }) => ({ id: step, header: label, nowrap: true })),
  ]
  const rows: DataRow[] = lots.map((lot) => ({
    id: lot.lotId,
    label: lot.label,
    cells: {
      lot: { value: lot.label, content: <LotName>{lot.label}</LotName> },
      ...Object.fromEntries(
        stages.map(({ step, label }) => {
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

  return <DataTable caption="Lots" columns={columns} rows={rows} />
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
