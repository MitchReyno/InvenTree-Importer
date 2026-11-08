import styled from 'styled-components'
import { Banner } from '../ui/Banner'
import type { CaptureSnapshotDto, ManualRunDto, ManualWorkspaceDto } from '@invimport/contracts'
import type { RunRecoverySelection } from '../../manual/types'
import { batchHref } from '../../navigation/batch-route'
import { color, space } from '../../theme/generated/tokens'
import { Pill } from '../ui/Pill'
import { StatusTimeline } from '../ui/StatusTimeline'
import { Heading, Link, Panel, Paragraph, Small } from '../ui/primitives'
import { TargetChip } from '../ui/TargetChip'
import { activeRun, checking, refused, roundSummary, RoundOutcome } from './RoundOutcome'

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

/** Changes › Added: what each approval added, what is still being checked, and what was refused. */
export function Added({ batch, workspace, focusedRunId, busy, command, targetUrl }: Props) {
  const runs = workspace.runs
  const focused = focusedRunId ? runs.find((value) => value.run_id === focusedRunId) : null
  const added = new Set(runs.flatMap((run) => run.confirmed_stock_ids)).size
  const beingChecked = runs.reduce((total, run) => total + checking(run), 0)
  const refusals = runs.reduce((total, run) => total + refused(run).length, 0)
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
        <TargetChip>Test InvenTree</TargetChip>
        <Pill tone={added ? 'ok' : 'neutral'}>{plural(added, 'stock item')} added</Pill>
        <Pill tone={beingChecked ? 'warn' : 'neutral'}>{beingChecked} being checked</Pill>
        <Pill tone={refusals ? 'bad' : 'neutral'}>{refusals} refused by InvenTree</Pill>
        {runs.some(activeRun) && <span>Adding now</span>}
      </Strip>
      {runs.length === 0 && (
        <Paragraph>Nothing has been added to InvenTree from this batch yet.</Paragraph>
      )}
      {focusedRunId && !focused && (
        <div role="status">
          <Banner tone="warn">
            That approval round is unavailable, and no other has been put in its place.{' '}
            <Link href={batchHref(batch.id, { tab: 'changes', view: 'added' })}>
              Show every round
            </Link>
          </Banner>
        </div>
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
          <Rows>
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
          </Rows>
        </Panel>
      )}
      {notIncluded.length > 0 && (
        <Panel aria-label="Not included">
          <Heading as="h3">Not included</Heading>
          <Rows>
            {notIncluded.map((lot) => (
              <li key={lot.id}>
                <Link href={batchHref(batch.id, { tab: 'review', view: 'lots', lotId: lot.id })}>
                  {lot.label}
                </Link>
              </li>
            ))}
          </Rows>
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
  gap: ${space[6]};
`
/** List rows with dividers, in place of bullets. */
const Rows = styled.ul`
  display: grid;
  margin: ${space[4]} 0 0;
  padding: 0;
  list-style: none;
  li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: ${space[4]};
    padding: ${space[4]} 0;
    border-top: 1px solid ${color.line};
  }
`
const Strip = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[4]} ${space[6]};
`
