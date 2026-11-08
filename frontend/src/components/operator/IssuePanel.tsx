import { useState } from 'react'
import styled from 'styled-components'
import { space } from '../../theme/generated/tokens'
import type { CaptureSnapshotDto, OperatorIssueDto } from '@invimport/contracts'
import type { OperatorReviewClient } from '../../operator/types'
import { Link, Small } from '../ui/primitives'
import { ProblemCard } from '../ui/ProblemCard'
import { Button } from '../ui/Button'
import { DismissWarning } from './DismissWarning'
import type { ProblemAction } from '../../operator/problem-actions'
import { batchHref } from '../../navigation/batch-route'
import { localTime } from '../ui/RelativeTime'

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
            size="sm"
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

  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

  return (
    <Cards>
      {blocking.length > 0 && (
        <ProblemCard
          severity="blocking"
          title={plural(blocking.length, 'blocking problem')}
          summary="Must be fixed before this lot can be approved."
          issues={blocking.map((issue) => ({
            title: issue.message,
            text: '',
            actions: (
              <>
                {fixes(issue)}
                {issue.run_id && (
                  <Link
                    href={batchHref(batch.id, {
                      tab: 'changes',
                      view: 'added',
                      runId: issue.run_id,
                    })}
                  >
                    Inspect original run
                  </Link>
                )}
              </>
            ),
          }))}
        />
      )}
      {warnings.length > 0 && (
        <ProblemCard
          severity="warning"
          title={plural(warnings.length, 'warning')}
          summary="Fix, or dismiss with a reason if it is fine as it is."
          issues={warnings.map((issue) => ({
            title: issue.message,
            text: subjectNote(batch, issue, partLotLabels) ?? '',
            actions: (
              <>
                {fixes(issue)}
                <Dismissal>
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
                </Dismissal>
              </>
            ),
          }))}
        />
      )}
    </Cards>
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
        Dismissed: “{issue.disposition.reason}”
        {localTime(issue.disposition.created_at) && ` · ${localTime(issue.disposition.created_at)}`}
      </Small>
    )
  }
  if (!client) {
    return null
  }
  if (!open) {
    return (
      <Button
        size="sm"
        variant="ghost"
        disabled={disabled || otherOpen}
        onClick={() => setOpen(true)}
      >
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

const Cards = styled.div`
  display: grid;
  gap: ${space[5]};
  margin: ${space[6]} 0;
`

const Dismissal = styled.div`
  flex: 1 1 100%;
`

const FixRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[3]};
`
