import styled from 'styled-components'
import type { AgentSessionDto } from '@invimport/contracts'
import { processingStepFor } from '#/navigation/batch-route'
import {
  DataTable,
  EventTime,
  StatePill,
  TableWrap,
  WORK_STATE,
  type WorkState,
} from '#/components/ui'
import { STEP_LABEL } from '#/components/processing/ProcessingParts'
import { workState } from '#/header/workSegments'
import type { FailureLoader } from './SessionFailureDetails'
import { AgentSessionCell, ENDED } from './AgentSessionCell'
import type { BatchNames } from './AgentSessions'

/** A session row's state word: its current attempt's own state, paused while its batch is. */
function rowState(session: AgentSessionDto): WorkState {
  // An ended attempt's own state is the outcome, even while its worker still holds the slot.
  if (ENDED.has(session.state)) {
    return workState(session.state)
  }
  if (session.paused && session.session_state !== 'finished') {
    return 'paused'
  }
  return workState(session.session_state ?? session.state)
}

const COLUMNS = [
  { id: 'session', header: 'Session' },
  { id: 'state', header: 'State', nowrap: true },
  { id: 'since', header: 'Since', mono: true, nowrap: true },
]

/** One batch's sessions, one row each. */
export function AgentSessionTable({
  caption,
  rows,
  names,
  loadFailure,
}: {
  caption: string
  rows: readonly AgentSessionDto[]
  names: BatchNames | undefined
  loadFailure?: FailureLoader
}) {
  return (
    <Table>
      <DataTable
        caption={caption}
        columns={COLUMNS}
        rows={rows.map((session) => {
          const subject =
            session.subject_id === null
              ? 'Whole batch'
              : (names?.subjects.get(session.subject_id) ?? 'Unknown subject')
          const title = `${STEP_LABEL[processingStepFor(session.stage)] ?? 'Processing'} · ${subject}`
          const state = rowState(session)
          return {
            id: session.job_id,
            label: title,
            cells: {
              session: {
                value: title,
                content: (
                  <AgentSessionCell
                    session={session}
                    title={title}
                    subject={subject}
                    names={names}
                    loadFailure={loadFailure}
                  />
                ),
              },
              state: { value: WORK_STATE[state].word, content: <StatePill state={state} /> },
              since: {
                value: session.state_since,
                content: <EventTime at={session.state_since} />,
              },
            },
          }
        })}
      />
    </Table>
  )
}

const Table = styled.div`
  ${TableWrap} {
    border: 0;
    border-radius: 0;
  }
`
