import styled from 'styled-components'
import type { ManualRunDto, PartOutputDto } from '@invimport/contracts'
import type { RunRecoverySelection } from '../../manual/types'
import { batchHref } from '../../navigation/batch-route'
import { color, space } from '../../theme/generated/tokens'
import {
  Button,
  Field,
  Heading,
  Link,
  Notice,
  Panel,
  Paragraph,
  Small,
  Summary,
} from '../ui/primitives'
import { AttachmentOutcome } from './AttachmentOutcome'
import { EffectOutcome } from './EffectOutcome'
import { PartAttachments } from './PartAttachments'

interface Props {
  run: ManualRunDto
  busy: boolean
  command: (
    run: ManualRunDto,
    action: 'start' | 'cancel' | 'recover',
    selection?: RunRecoverySelection,
  ) => void
  targetUrl: string | null
}

const STATES: Record<ManualRunDto['state'], string> = {
  queued: 'Approved, waiting to be queued',
  running: 'Adding to InvenTree',
  stopping: 'Stopping',
  settled_complete: 'Added',
  settled_incomplete: 'Stopped before every record was added',
  recovery_required: 'Needs checking',
}

export const activeRun = (run: ManualRunDto) =>
  ['queued', 'running', 'stopping'].includes(run.state) && run.dispatch_state !== 'not_requested'

const PART_VALUES = new Set(['create_part', 'parameter', 'manufacturer', 'supplier'])

/**
 * A Part value InvenTree did not take: in a finished round that was not cancelled, it has no
 * result and nothing to resume or inspect, so the fix is in Review.
 */
export function toFix(run: ManualRunDto) {
  const finished = run.state === 'settled_incomplete' || run.state === 'recovery_required'
  return finished && !run.cancellation_requested
    ? (run.supported_effects ?? []).filter(
        (effect) =>
          PART_VALUES.has(effect.kind) &&
          effect.certainty === 'none' &&
          effect.recovery_action === null,
      )
    : []
}

export function roundSummary(run: ManualRunDto) {
  const added = run.confirmed_stock_ids.length
  if (run.state === 'recovery_required' || run.effect_certainty === 'unknown') {
    return 'needs checking'
  }
  if (run.state === 'queued' && run.dispatch_state === 'not_requested') {
    return 'waiting to be queued'
  }
  if (run.state === 'settled_incomplete') {
    return `stopped, ${added} stock ${added === 1 ? 'item' : 'items'} added`
  }
  if (run.state === 'settled_complete') {
    return `${added} stock ${added === 1 ? 'item' : 'items'} added`
  }
  return STATES[run.state].toLowerCase()
}

function TargetLink({
  base,
  path,
  children,
}: {
  base: string | null
  path: string
  children: string
}) {
  return base ? <Link href={`${base}${path}`}>{children}</Link> : <>{children}</>
}

function partStatus(output: PartOutputDto, unstarted: boolean, base: string | null) {
  if (output.usable) {
    return (
      <>
        <TargetLink base={base} path={`part/${output.remote_pks[0]}/`}>
          {`Part ${output.remote_pks[0]}`}
        </TargetLink>{' '}
        is ready
      </>
    )
  }
  if (
    unstarted &&
    output.certainty === 'none' &&
    output.remote_pks.length === 0 &&
    output.verification === null
  ) {
    return 'Will be created once this round is queued'
  }
  return 'Being checked; it is never created again'
}

/** One approval round: what it added, what is being checked, and its own recovery actions. */
export function RoundOutcome({ run, busy, command, targetUrl }: Props) {
  const cancellable = ['queued', 'running', 'stopping'].includes(run.state)
  const unstarted = run.state === 'queued' && run.dispatch_state === 'not_requested'
  const rejected = new Set(toFix(run).map((effect) => effect.operation_key))
  return (
    <Panel id={`run-${run.run_id}`} aria-label={`Round ${run.round_number}`}>
      <Heading>
        Round {run.round_number} · {STATES[run.state]}
      </Heading>
      {run.state === 'recovery_required' && (
        <Notice>
          Stock may have been created, or the original physical owner may still be active. Nothing
          is created again; each record is checked by its import reference first.
        </Notice>
      )}
      {unstarted && (
        <>
          <Paragraph>Approved. Nothing has been sent to InvenTree yet.</Paragraph>
          <Button disabled={busy} onClick={() => command(run, 'start')}>
            Queue supervised apply
          </Button>
        </>
      )}
      {run.dispatch_state === 'queued' && (
        <Paragraph role="status">
          Waiting for the supervised runner. Closing this page does not cancel the request.
        </Paragraph>
      )}
      {run.part_outputs?.map((output) => (
        <Row key={output.operation_key}>
          <strong>{output.label}</strong>
          <Paragraph>{partStatus(output, unstarted, targetUrl)}</Paragraph>
          {!output.usable && output.remote_pks.length > 0 && (
            <Small>Matched records: {output.remote_pks.join(', ')}</Small>
          )}
        </Row>
      ))}
      {run.part_attachments && <PartAttachments attachments={run.part_attachments} />}
      {run.supported_effects?.map((effect) => (
        <EffectOutcome
          key={effect.operation_key}
          effect={effect}
          busy={busy}
          unstarted={unstarted}
          fixHref={
            rejected.has(effect.operation_key)
              ? batchHref(run.batch_id, {
                  tab: 'review',
                  view: 'records',
                  recordType: 'part',
                  recordId: effect.part_subject_id,
                })
              : undefined
          }
          recover={() =>
            command(run, 'recover', {
              kind: effect.recovery_action === 'verify_effect' ? 'assessment' : 'effect',
              keys: [effect.operation_key],
            })
          }
        />
      ))}
      {run.operations.map((operation) => (
        <Row key={operation.operation_key}>
          <strong>
            {operation.lot_label} · {operation.quantity}
          </strong>
          <Paragraph>
            {operation.certainty === 'confirmed' && operation.remote_pk ? (
              <>
                <TargetLink base={targetUrl} path={`stock/item/${operation.remote_pk}/`}>
                  {`Stock item ${operation.remote_pk}`}
                </TargetLink>{' '}
                added
              </>
            ) : operation.certainty === 'unknown' ? (
              `${operation.lot_label} is being checked by its import reference. It is never created again.`
            ) : (
              'Not added yet'
            )}
          </Paragraph>
          {operation.certainty === 'unknown' && operation.remote_pk && (
            <Small>
              Matched stock item {operation.remote_pk}; its full result is not confirmed yet.
            </Small>
          )}
          {operation.recovery_allowed && (
            <Button
              disabled={busy}
              onClick={() =>
                command(run, 'recover', { kind: 'stock', keys: [operation.operation_key] })
              }
            >
              Resume original operation: {operation.lot_label}
            </Button>
          )}
        </Row>
      ))}
      {run.attachments?.map((attachment) => (
        <AttachmentOutcome
          key={attachment.artifact_key}
          attachment={attachment}
          busy={busy}
          recover={() =>
            command(run, 'recover', { kind: 'attachment', keys: [attachment.artifact_key] })
          }
        />
      ))}
      {cancellable && (
        <Field>
          <Small>Cancelling stops further requests; it cannot undo one already sent.</Small>
          <Button
            disabled={busy || run.state === 'stopping'}
            onClick={() => command(run, 'cancel')}
          >
            Request cancellation
          </Button>
        </Field>
      )}
      <details>
        <Summary>Round details</Summary>
        <Details>
          <Small>Run {run.run_id}</Small>
          <Small>Approval {run.approval_id}</Small>
          <Small>
            State {run.state} · certainty {run.effect_certainty} · revision {run.revision}
          </Small>
          {run.cancellation_requested && <Small>Cancellation was requested.</Small>}
        </Details>
      </details>
    </Panel>
  )
}

const Row = styled.div`
  padding: ${space[3]} 0;
  border-top: 1px solid ${color.line};
`
const Details = styled.div`
  display: grid;
  gap: ${space[1]};
  overflow-wrap: anywhere;
`
