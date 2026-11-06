import styled from 'styled-components'
import type { CaptureSnapshotDto, ManualRunDto, ManualWorkspaceDto } from '@invimport/contracts'
import type { RunRecoverySelection } from '../../manual/types'
import { batchHref } from '../../navigation/batch-route'
import { space } from '../../theme/generated/tokens'
import { Pill } from '../ui/Pill'
import { StatusTimeline } from '../ui/StatusTimeline'
import { Heading, Link, Notice, Panel, Paragraph, Small } from '../ui/primitives'
import { activeRun, roundSummary, RoundOutcome, toFix } from './RoundOutcome'

interface Props {
  batch: CaptureSnapshotDto
  workspace: ManualWorkspaceDto
  focusedRunId?: string
  busy: boolean
  command: (
    run: ManualRunDto,
    action: 'start' | 'cancel' | 'recover',
    selection?: RunRecoverySelection,
  ) => void
  /** The InvenTree web address from the connection status, for links to added records. */
  targetUrl: string | null
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`

/** Changes › Added: what each approval added, what is still being checked, and what to fix. */
export function Added({ batch, workspace, focusedRunId, busy, command, targetUrl }: Props) {
  const runs = workspace.runs
  const focused = focusedRunId ? runs.find((value) => value.run_id === focusedRunId) : null
  const added = new Set(runs.flatMap((run) => run.confirmed_stock_ids)).size
  const checking = runs.reduce(
    (total, run) =>
      total +
      run.operations.filter((value) => value.certainty === 'unknown').length +
      // Stock creates also appear as effects and are counted once, from the operations; a
      // refused value is to fix, not being checked.
      (run.supported_effects ?? []).filter(
        (value) =>
          value.kind !== 'create_stock' && value.certainty === 'unknown' && !value.rejected,
      ).length +
      (run.attachments ?? []).filter((value) => value.certainty === 'unknown').length,
    0,
  )
  const fixes = runs.reduce((total, run) => total + toFix(run).length, 0)
  // Lots neither added by a round nor waiting in a prepared selection.
  const placed = new Set([
    ...runs.flatMap((run) => run.operations.map((value) => value.lot_id)),
    ...workspace.preparations.flatMap((value) => value.effects.map((effect) => effect.lot_id)),
  ])
  const notIncluded = batch.lots.filter((lot) => !lot.retired && !placed.has(lot.id))
  const shown = focusedRunId ? (focused ? [focused] : []) : runs

  return (
    <Layout>
      <Strip role="region" aria-label="Outcome">
        <Pill tone="info">Test InvenTree</Pill>
        <strong>{plural(added, 'stock item')} added</strong>
        <span>{checking} being checked</span>
        <span>{fixes} to fix</span>
        {runs.some(activeRun) && <span>Adding now</span>}
      </Strip>
      {runs.length === 0 && (
        <Paragraph>Nothing has been added to InvenTree from this batch yet.</Paragraph>
      )}
      {focusedRunId && !focused && (
        <Notice role="status">
          That approval round is unavailable, and no other has been put in its place.{' '}
          <Link href={batchHref(batch.id, { tab: 'changes', view: 'added' })}>
            Show every round
          </Link>
        </Notice>
      )}
      {shown.map((run) => (
        <RoundOutcome
          key={run.run_id}
          run={run}
          busy={busy}
          command={command}
          targetUrl={targetUrl}
        />
      ))}
      {workspace.preparations.length > 0 && (
        <Panel aria-labelledby="pending-changes">
          <Heading id="pending-changes">Pending changes</Heading>
          <ul>
            {workspace.preparations.map((preparation) => {
              const lots = preparation.effects.map((effect) => effect.lot_label).join(', ')
              return (
                <li key={preparation.id}>
                  <Link
                    href={batchHref(batch.id, {
                      tab: 'changes',
                      view: 'ready',
                      preparationId: preparation.id,
                    })}
                    aria-label={`${lots}, prepared and not yet approved`}
                  >
                    {lots}
                  </Link>{' '}
                  <Small>prepared, not yet approved</Small>
                </li>
              )
            })}
          </ul>
        </Panel>
      )}
      {notIncluded.length > 0 && (
        <Panel aria-label="Not included">
          <Heading as="h3">Not included</Heading>
          <ul>
            {notIncluded.map((lot) => (
              <li key={lot.id}>
                <Link href={batchHref(batch.id, { tab: 'review', view: 'lots', lotId: lot.id })}>
                  {lot.label}
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {runs.length > 0 && (
        <Panel aria-labelledby="activity">
          <Heading id="activity" as="h3">
            Activity
          </Heading>
          <StatusTimeline
            label="Activity"
            entries={runs.map((run, index) => ({
              text: `Round ${run.round_number} approved: ${roundSummary(run)}`,
              time: '',
              current: index === runs.length - 1,
            }))}
          />
          <Small>Rounds are listed in the order they were approved; no times are kept.</Small>
        </Panel>
      )}
    </Layout>
  )
}

const Layout = styled.div`
  display: grid;
  gap: ${space[3]};
`
const Strip = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[2]} ${space[3]};
`
