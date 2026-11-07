import { useState } from 'react'
import styled from 'styled-components'
import { color } from '../../theme/generated/tokens'
import type { CaptureSnapshotDto, OperatorIssueDto } from '@invimport/contracts'
import type { OperatorReviewClient } from '../../operator/types'
import { Link, Paragraph, Small } from '../ui/primitives'
import { Button } from '../ui/Button'
import { DismissWarning } from './DismissWarning'
import type { ProblemAction } from '../../operator/problem-actions'
import { batchHref } from '../../navigation/batch-route'

interface Props {
  batch: CaptureSnapshotDto
  issues: OperatorIssueDto[]
  /** Active lots sharing the focused lot's Part proposal, including the focused lot. */
  partLotLabels: string[]
  client?: OperatorReviewClient
  disabled: boolean
  reload: () => Promise<void>
  onDirtyChange?: (dirty: boolean) => void
  /** The fixes each problem offers, routed to their owners. */
  actionsFor?: (issue: OperatorIssueDto) => ProblemAction[]
  onEditValues?: () => void
  onEditPart?: () => void
}

function Fixes({
  actions,
  disabled,
  onEditValues,
  onEditPart,
}: {
  actions: ProblemAction[]
  disabled: boolean
  onEditValues?: () => void
  onEditPart?: () => void
}) {
  if (!actions.length) {
    return null
  }

  return (
    <FixRow>
      {actions.map((action) =>
        action.kind === 'link' ? (
          <Link key={action.label} href={action.href}>
            {action.label}
          </Link>
        ) : (
          <Button
            key={action.label}
            disabled={disabled || (action.kind === 'edit_values' ? !onEditValues : !onEditPart)}
            onClick={action.kind === 'edit_values' ? onEditValues : onEditPart}
          >
            {action.label}
          </Button>
        ),
      )}
    </FixRow>
  )
}

function issueKey(issue: OperatorIssueDto) {
  return `${issue.subject_id ?? 'batch'}:${issue.code}`
}

function subjectNote(batch: CaptureSnapshotDto, issue: OperatorIssueDto, partLotLabels: string[]) {
  const part = batch.parts.find((value) => value.id === issue.subject_id)
  if (!part) {
    return null
  }
  const count = partLotLabels.length
  return `On shared Part proposal ${part.label}. Dismissing it affects ${count} lot${count === 1 ? '' : 's'} (${partLotLabels.join(', ')}); their current reviews will need renewing.`
}

/** Blocking problems cannot be dismissed; warnings need a fix or a recorded reason. */
export function IssuePanel({
  batch,
  issues,
  partLotLabels,
  client,
  disabled,
  reload,
  onDirtyChange,
  actionsFor,
  onEditValues,
  onEditPart,
}: Props) {
  const fixes = (issue: OperatorIssueDto) => (
    <Fixes
      actions={actionsFor?.(issue) ?? []}
      disabled={disabled}
      onEditValues={onEditValues}
      onEditPart={onEditPart}
    />
  )

  const [dismissing, setDismissing] = useState<string | null>(null)
  const blocking = issues.filter((issue) => issue.severity === 'blocking')
  const warnings = issues.filter((issue) => issue.severity === 'warning')
  return (
    <>
      {blocking.length > 0 && (
        <Box $tone="red" aria-label="Blocking problems">
          <Paragraph>
            <strong>
              × {blocking.length} blocking problem{blocking.length === 1 ? '' : 's'}
            </strong>{' '}
            Must be fixed before this lot can be approved.
          </Paragraph>
          {blocking.map((issue, index) => (
            <Item key={`${issue.code}:${index}`}>
              <Paragraph>{issue.message}</Paragraph>
              {fixes(issue)}
              {issue.run_id && (
                <Link
                  href={batchHref(batch.id, { tab: 'changes', view: 'added', runId: issue.run_id })}
                >
                  Inspect original run
                </Link>
              )}
            </Item>
          ))}
        </Box>
      )}
      {warnings.length > 0 && (
        <Box $tone="amber" aria-label="Warnings">
          <Paragraph>
            <strong>
              ! {warnings.length} warning{warnings.length === 1 ? '' : 's'}
            </strong>{' '}
            Fix, or dismiss with a reason if it is fine as it is.
          </Paragraph>
          {warnings.map((issue) => (
            <Item key={issueKey(issue)}>
              <Paragraph>{issue.message}</Paragraph>
              {subjectNote(batch, issue, partLotLabels) && (
                <Small>{subjectNote(batch, issue, partLotLabels)}</Small>
              )}
              {fixes(issue)}
              <WarningAction
                batch={batch}
                issue={issue}
                client={client}
                disabled={disabled}
                open={dismissing === issueKey(issue)}
                otherOpen={dismissing !== null && dismissing !== issueKey(issue)}
                setOpen={(open) => setDismissing(open ? issueKey(issue) : null)}
                reload={reload}
                onDirtyChange={onDirtyChange}
              />
            </Item>
          ))}
        </Box>
      )}
    </>
  )
}

interface WarningActionProps {
  batch: CaptureSnapshotDto
  issue: OperatorIssueDto
  client?: OperatorReviewClient
  disabled: boolean
  open: boolean
  otherOpen: boolean
  setOpen: (open: boolean) => void
  reload: () => Promise<void>
  onDirtyChange?: (dirty: boolean) => void
}

function WarningAction(props: WarningActionProps) {
  const { batch, issue, client, disabled, open, otherOpen, setOpen, reload, onDirtyChange } = props
  if (issue.disposition) {
    return (
      <Small>
        Dismissed: “{issue.disposition.reason}” ·{' '}
        {new Date(issue.disposition.created_at).toLocaleString()}
      </Small>
    )
  }
  if (!client) {
    return null
  }
  if (!open) {
    return (
      <Button disabled={disabled || otherOpen} onClick={() => setOpen(true)}>
        Dismiss…
      </Button>
    )
  }
  return (
    <DismissWarning
      batch={batch}
      issue={issue}
      client={client}
      disabled={disabled}
      onDismissed={async () => {
        setOpen(false)
        await reload()
      }}
      onCancel={() => setOpen(false)}
      onDirtyChange={onDirtyChange}
    />
  )
}

const TONES = {
  red: { border: color.bad, background: color.badWeak },
  amber: { border: color.warn, background: color.warnWeak },
}

const Box = styled.section<{ $tone: keyof typeof TONES }>`
  padding: 12px 14px;
  margin: 12px 0;
  border: 1px solid ${(p) => TONES[p.$tone].border};
  background: ${(p) => TONES[p.$tone].background};
  border-radius: 6px;
`
const Item = styled.div`
  padding: 8px 0;
  border-top: 1px solid ${color.line};
  display: grid;
  gap: 6px;
  justify-items: start;
`

const FixRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 4px 0;
`
