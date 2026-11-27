import styled from 'styled-components'
import type { MatchLotDto, MatchQuestionDto } from '@invimport/contracts'
import { DataTable, EventTime, Pill, type DataRow } from '#/components/ui'
import { keyText, lotResult, lotRuns } from '#/processing/match-view'
import { color, space, typeVar } from '#/theme/generated/tokens'
import { MatchedBy } from './MatchedBy'
import { MatchRowAction } from './MatchRowAction'

const COLUMNS = [
  { id: 'lot', header: 'Lot' },
  { id: 'keys', header: 'Matched by' },
  { id: 'result', header: 'Result', nowrap: true },
  { id: 'runs', header: 'What runs' },
  { id: 'action', header: 'Action', nowrap: true },
]

/** A live lot of the batch, with Match's state for it once it has been searched. */
export type MatchRow = { lotId: string; label: string; match?: MatchLotDto }

type Props = {
  batchId: string
  rows: MatchRow[]
  questions: readonly MatchQuestionDto[]
  /** Why Search again and Change can't be sent now, such as a read still landing. */
  unavailableReason?: string
  busyLot: string | null
  searchAgain: (lotId: string) => void
  decideAgain: (lotId: string) => void
}

/** Each lot with the keys Match searched by, its result, what runs in which mode and its action. */
export function MatchTable({
  batchId,
  rows,
  questions,
  unavailableReason,
  busyLot,
  searchAgain,
  decideAgain,
}: Props) {
  const tableRows: DataRow[] = rows.map(({ lotId, label, match }) => {
    const question = match?.question_id
      ? questions.find((candidate) => candidate.id === match.question_id)
      : undefined
    const result = match
      ? lotResult(match, question)
      : { text: 'Not searched yet', tone: 'outline' as const, glyph: '–' }
    const runs = match ? lotRuns(match, question) : ''
    const keys = match?.keys.filter((key) => key.kind !== 'batch_code') ?? []

    return {
      id: lotId,
      label,
      name: label,
      cells: {
        lot: { value: label, content: <b>{label}</b> },
        keys: {
          value: keys.map(keyText).join(', '),
          content: <MatchedBy match={match} />,
        },
        result: {
          value: result.text,
          content: (
            <Result>
              <Pill tone={result.tone} glyph={result.glyph}>
                {result.text}
              </Pill>
              {match?.decided_at && match.state === 'decided' && (
                <Muted>
                  You answered <EventTime at={match.decided_at} clockToday />
                </Muted>
              )}
            </Result>
          ),
        },
        runs: { value: runs, content: <Muted>{runs || '—'}</Muted> },
        action: {
          value: '',
          content: match && (
            <MatchRowAction
              batchId={batchId}
              label={label}
              match={match}
              unavailableReason={unavailableReason}
              busy={busyLot === match.lot_id}
              searchAgain={searchAgain}
              decideAgain={decideAgain}
            />
          ),
        },
      },
    }
  })

  return <DataTable caption="Lots and their matches" columns={COLUMNS} rows={tableRows} />
}

const Result = styled.span`
  display: grid;
  justify-items: start;
  gap: ${space[1]};
`

const Muted = styled.span`
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`
