import { PreparedPartAttachments } from '../review/PreparedPartAttachments'
import { SupportedEffectResult } from './SupportedEffectResult'
import { AttachmentResult } from './AttachmentResult'
import type { RunRecoverySelection } from '../../manual/types'
import styled from 'styled-components'
import { color } from '../../theme/generated/tokens'
import type { ManualRunDto, PartOutputDto } from '@invimport/contracts'
import {
  Button,
  Heading,
  Panel,
  Paragraph,
  Small,
  Notice,
  Summary,
  Field,
  Link,
} from '../ui/primitives'
import { batchHref } from '../../navigation/batch-route'

interface Props {
  run: ManualRunDto
  busy: boolean
  command: (
    run: ManualRunDto,
    action: 'start' | 'cancel' | 'recover',
    selection?: RunRecoverySelection,
  ) => void
}
const states: Record<ManualRunDto['state'], string> = {
  queued: 'Approved · waiting for supervised apply',
  running: 'Supervised apply is running',
  stopping: 'Stopping new dispatch',
  settled_complete: 'Selected stock is confirmed',
  settled_incomplete: 'Original run is safely incomplete',
  recovery_required: 'Original run needs inspection',
}

function partOutputStatus(output: PartOutputDto, unstarted: boolean) {
  if (output.usable) {
    return `Part #${output.remote_pks[0]} is known and usable`
  }
  if (
    unstarted &&
    output.certainty === 'none' &&
    output.remote_pks.length === 0 &&
    output.verification === null
  ) {
    return 'Part creation is planned · not queued'
  }
  return 'Part identity needs inspection'
}

export function RunResult({ run, busy, command }: Props) {
  const untouched = run.operations.filter((value) => value.recovery_allowed)
  const cancellable = ['queued', 'running', 'stopping'].includes(run.state)
  const unstarted = run.state === 'queued' && run.dispatch_state === 'not_requested'
  return (
    <Panel id={`run-${run.run_id}`}>
      <Outcome $confirmed={run.state === 'settled_complete'}>
        <Heading>
          Round {run.round_number} · {states[run.state]}
        </Heading>
        <Small>
          {run.confirmed_stock_ids.length} confirmed stock record
          {run.confirmed_stock_ids.length === 1 ? '' : 's'} · owned fake only
        </Small>
      </Outcome>
      {run.state === 'recovery_required' && (
        <Notice>
          Stock may have been created, or the original physical owner may still be active. Do not
          create again. Retained authority stays blocked until supported inspection establishes what
          happened.
        </Notice>
      )}
      {run.state === 'queued' && run.dispatch_state === 'not_requested' && (
        <>
          <Paragraph>
            Approval is retained. No stock effect has been confirmed; explicitly queue this original
            run.
          </Paragraph>
          <Button disabled={busy} onClick={() => command(run, 'start')}>
            Queue supervised apply
          </Button>
        </>
      )}
      {run.dispatch_state === 'queued' && (
        <Paragraph role="status">
          Waiting for the separately started owned-fake runner. Closing this page does not cancel
          the retained request.
        </Paragraph>
      )}
      {run.part_outputs?.map((output) => (
        <Operation key={output.operation_key}>
          <strong>{output.label}</strong>
          <Paragraph>{partOutputStatus(output, unstarted)}</Paragraph>
          {output.remote_pks.length > 0 && (
            <Small>Retained attributable IDs: {output.remote_pks.join(', ')}</Small>
          )}
          <Small>Dependent failures do not erase this output.</Small>
        </Operation>
      ))}
      {run.part_attachments && <PreparedPartAttachments attachments={run.part_attachments} />}
      {run.supported_effects?.map((effect) => (
        <SupportedEffectResult
          key={effect.operation_key}
          effect={effect}
          busy={busy}
          unstarted={unstarted}
          recover={() =>
            command(run, 'recover', {
              kind: effect.recovery_action === 'verify_effect' ? 'assessment' : 'effect',
              keys: [effect.operation_key],
            })
          }
        />
      ))}
      {run.operations.map((operation) => (
        <Operation key={operation.operation_key}>
          <strong>
            {operation.lot_label} · {operation.quantity} pieces
          </strong>
          <Paragraph>
            {operation.certainty === 'confirmed'
              ? `Stock #${operation.remote_pk} confirmed`
              : operation.certainty === 'unknown'
                ? 'May have been created · never retry as a new contribution'
                : 'No stock effect confirmed for this operation'}
          </Paragraph>
          {operation.certainty === 'unknown' && operation.remote_pk && (
            <Small>
              Attributed record #{operation.remote_pk}; its complete effect is unconfirmed.
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
        </Operation>
      ))}
      {run.attachments?.map((attachment) => (
        <AttachmentResult
          key={attachment.artifact_key}
          attachment={attachment}
          busy={busy}
          recover={() =>
            command(run, 'recover', { kind: 'attachment', keys: [attachment.artifact_key] })
          }
        />
      ))}
      {untouched.length > 0 && (
        <Small>
          Recovery is selected under this original approval and run. It never allocates replacement
          stock authority.
        </Small>
      )}
      {cancellable && (
        <Field>
          <Small>
            Cancellation stops new dispatch; it cannot roll back an already authorized request.
          </Small>
          <Button
            disabled={busy || run.state === 'stopping'}
            onClick={() => command(run, 'cancel')}
          >
            Request cancellation
          </Button>
        </Field>
      )}
      <details>
        <Summary>Retained run details</Summary>
        <Details>
          <Paragraph>Run {run.run_id}</Paragraph>
          <Paragraph>Approval {run.approval_id}</Paragraph>
          <Paragraph>
            State {run.state} · certainty {run.effect_certainty} · revision {run.revision}
          </Paragraph>
          <Paragraph>Cursor {run.cursor.sequence}</Paragraph>
          {run.cancellation_requested && (
            <Paragraph>Cancellation was requested; historical effects remain retained.</Paragraph>
          )}
        </Details>
      </details>
      <Link href={batchHref(run.batch_id, { tab: 'review', view: 'lots' })}>
        Continue reviewing remaining lots
      </Link>
    </Panel>
  )
}

const Outcome = styled.div<{ $confirmed: boolean }>`
  padding: 14px;
  border: 1px solid ${(p) => (p.$confirmed ? color.ok : color.lineStrong)};
  background: ${(p) => (p.$confirmed ? color.okWeak : color.accentWeak)};
  border-radius: 6px;
  margin-bottom: 16px;
`
const Operation = styled.div`
  padding: 16px 0;
  border-top: 1px solid ${color.line};
`
const Details = styled.div`
  font-size: 12px;
  overflow-wrap: anywhere;
`
