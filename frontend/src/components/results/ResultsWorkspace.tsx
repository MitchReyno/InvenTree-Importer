import styled from 'styled-components'
import type { ManualRunDto } from '@invimport/contracts'
import { Heading, Panel, Paragraph, Link } from '../ui/primitives'
import { RunResult } from './RunResult'

interface Props {
  batchId: string
  runs: ManualRunDto[]
  focusedRunId?: string
  busy: boolean
  command: (run: ManualRunDto, action: 'start' | 'cancel' | 'recover', keys?: string[]) => void
}

export function ResultsWorkspace({ batchId, runs, focusedRunId, busy, command }: Props) {
  const focused = focusedRunId ? runs.find((value) => value.run_id === focusedRunId) : null
  return (
    <Results>
      <Panel>
        <Heading>Original approval rounds</Heading>
        <Paragraph>
          Results come from retained request/effect history. Missing or consumed stock never
          authorizes replenishment.
        </Paragraph>
        {runs.length > 1 && (
          <nav aria-label="Approval rounds">
            {runs.map((run) => (
              <RoundLink key={run.run_id} href={`#${batchId}/results/${run.run_id}`}>
                Round {run.round_number} · {run.confirmed_stock_ids.length} confirmed
              </RoundLink>
            ))}
          </nav>
        )}
      </Panel>
      {runs.length === 0 && (
        <Panel>
          <Paragraph>No approval has been retained for this batch.</Paragraph>
          <Link href={`#${batchId}/review`}>Review exact saved lots</Link>
        </Panel>
      )}
      {(focused ? [focused] : runs).map((run) => (
        <RunResult key={run.run_id} run={run} busy={busy} command={command} />
      ))}
    </Results>
  )
}

const Results = styled.div`
  max-width: 1050px;
  margin: auto;
`
const RoundLink = styled(Link)`
  display: inline-block;
  margin: 0 12px 8px 0;
  min-height: 36px;
`
