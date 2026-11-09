import styled from 'styled-components'
import {
  Banner,
  Field,
  Heading,
  Link,
  Panel,
  Paragraph,
  Small,
  Summary,
  Button,
} from '#/components/ui'
import type { ManualRunDto, PartOutputDto } from '@invimport/contracts'
import type { RunRecoverySelection } from '#/manual/types'
import { batchHref } from '#/navigation/batch-route'
import { color, space } from '#/theme/generated/tokens'
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

/** Values InvenTree refused as invalid; no record came of them. */
export function refused(run: ManualRunDto) {
  return (run.supported_effects ?? []).filter((effect) => effect.rejected === true)
}

const refusedStock = (run: ManualRunDto, operationKey: string) =>
  refused(run).some(
    (effect) => effect.kind === 'create_stock' && effect.operation_key === operationKey,
  )

/** Uncertain results still being checked, leaving out refusals and stock creates counted twice. */
export function checking(run: ManualRunDto) {
  return (
    run.operations.filter(
      (value) => value.certainty === 'unknown' && !refusedStock(run, value.operation_key),
    ).length +
    (run.supported_effects ?? []).filter(
      (value) => value.kind !== 'create_stock' && value.certainty === 'unknown' && !value.rejected,
    ).length +
    (run.attachments ?? []).filter((value) => value.certainty === 'unknown').length
  )
}

/** Unfinished work the operator can act on: checks, refusals, stops, resumes and repairs. */
export function needsAttention(run: ManualRunDto) {
  return (
    checking(run) > 0 ||
    refused(run).length > 0 ||
    run.state === 'recovery_required' ||
    run.state === 'settled_incomplete' ||
    run.operations.some((operation) => operation.recovery_allowed) ||
    (run.supported_effects ?? []).some((effect) => Boolean(effect.recovery_action)) ||
    (run.attachments ?? []).some(
      (attachment) =>
        Boolean(attachment.recovery_action) || attachment.verification === 'missing_or_changed',
    )
  )
}

/** A round that needs checking only because InvenTree refused something. */
const heldByRefusal = (run: ManualRunDto) =>
  run.state === 'recovery_required' && refused(run).length > 0 && checking(run) === 0

export function roundSummary(run: ManualRunDto) {
  const added = run.confirmed_stock_ids.length
  if (heldByRefusal(run)) {
    return 'InvenTree refused a value'
  }
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

function partStatus(
  output: PartOutputDto,
  unstarted: boolean,
  base: string | null,
  refusedPart: boolean,
) {
  if (refusedPart) {
    return 'InvenTree refused this Part, so it was not created.'
  }
  if (output.usable) {
    return (
      <>
        <TargetLink base={base} path={`web/part/${output.remote_pks[0]}/`}>
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

  /** Where a refused value is set: its Part record or lot in Review, or a draft in Capture. */
  const fixPlace = (effect: NonNullable<ManualRunDto['supported_effects']>[number]) =>
    !effect.rejected
      ? undefined
      : effect.kind === 'create_stock'
        ? {
            place: 'Review' as const,
            href: batchHref(run.batch_id, {
              tab: 'review',
              view: 'lots',
              lotId: effect.part_subject_id,
            }),
          }
        : PART_VALUES.has(effect.kind) || effect.kind === 'part_attachment'
          ? {
              place: 'Review' as const,
              href: batchHref(run.batch_id, {
                tab: 'review',
                view: 'records',
                recordType: 'part',
                recordId: effect.part_subject_id,
              }),
            }
          : { place: 'Capture' as const, href: batchHref(run.batch_id, { tab: 'capture' }) }

  return (
    <Panel id={`run-${run.run_id}`} aria-label={`Round ${run.round_number}`}>
      <Heading>
        Round {run.round_number} · {STATES[run.state]}
      </Heading>
      {run.state === 'recovery_required' &&
        (heldByRefusal(run) ? (
          <Banner tone="warn">
            InvenTree refused a value in this round, so nothing was created for it. The round stays
            open and holds this batch’s source, so a corrected value cannot be sent yet.
          </Banner>
        ) : (
          <Banner tone="warn">
            Stock may have been created, or the original physical owner may still be active. Nothing
            is created again; each record is checked by its import reference first.
          </Banner>
        ))}
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
          <Paragraph>
            {partStatus(
              output,
              unstarted,
              targetUrl,
              refused(run).some((effect) => effect.operation_key === output.operation_key),
            )}
          </Paragraph>
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
          fix={fixPlace(effect)}
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
                <TargetLink base={targetUrl} path={`web/stock/item/${operation.remote_pk}/`}>
                  {`Stock item ${operation.remote_pk}`}
                </TargetLink>{' '}
                added
              </>
            ) : refusedStock(run, operation.operation_key) ? (
              'InvenTree refused this stock item, so it was not created.'
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
  padding: ${space[6]} 0;
  border-top: 1px solid ${color.line};
`
const Details = styled.div`
  display: grid;
  gap: ${space[2]};
  overflow-wrap: anywhere;
`
