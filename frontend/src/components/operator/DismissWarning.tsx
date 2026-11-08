import { useEffect } from 'react'
import { Banner } from '../ui/Banner'
import { useForm } from 'react-hook-form'
import type { CaptureSnapshotDto, OperatorIssueDto } from '@invimport/contracts'
import type { OperatorReviewClient } from '../../operator/types'
import { useRetainedCommand } from '../../operator/useRetainedCommand'
import { Form, Label, Small, TextArea } from '../ui/primitives'
import { Button } from '../ui/Button'

const MAX_REASON_LENGTH = 1024

interface Props {
  batch: CaptureSnapshotDto
  issue: OperatorIssueDto
  client: OperatorReviewClient
  disabled: boolean
  onDismissed: () => Promise<void>
  onCancel: () => void
  onDirtyChange?: (dirty: boolean) => void
}

/** A dismissal records why the warning is acceptable for these exact facts. */
export function DismissWarning({
  batch,
  issue,
  client,
  disabled,
  onDismissed,
  onCancel,
  onDirtyChange,
}: Props) {
  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm({ defaultValues: { reason: '' } })
  // The retained intent freezes the revision it was first sent with, so a retry is exact.
  const command = useRetainedCommand((input: { reason: string; revision: string }, key: string) =>
    client.dismiss(
      batch.id,
      {
        expected_batch_revision: input.revision,
        subject_id: issue.subject_id!,
        code: issue.code,
        dependency_digest: issue.dependency_digest!,
        reason: input.reason,
      },
      key,
    ),
  )

  useEffect(() => {
    onDirtyChange?.(isDirty || command.pending)
  }, [isDirty, command.pending, onDirtyChange])

  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  async function finish(result: unknown) {
    if (result) {
      onDirtyChange?.(false)
      await onDismissed()
    }
  }

  async function submit(values: { reason: string }) {
    await finish(await command.submit({ reason: values.reason.trim(), revision: batch.revision }))
  }

  async function retry() {
    await finish(await command.retry())
  }

  return (
    <Form
      onChange={() => onDirtyChange?.(true)}
      onSubmit={handleSubmit(submit)}
      aria-label={`Dismiss ${issue.code}`}
    >
      <Label>
        Why is this acceptable?
        <TextArea
          {...register('reason', {
            validate: (value) => value.trim().length > 0 || 'Give a reason before dismissing.',
            maxLength: {
              value: MAX_REASON_LENGTH,
              message: 'Keep the reason under 1024 characters.',
            },
          })}
          aria-invalid={errors.reason ? true : undefined}
          disabled={command.pending}
        />
      </Label>
      {errors.reason && <Small role="alert">{errors.reason.message}</Small>}
      <Small>
        The dismissal binds to the current facts. Any later change to them brings the warning back.
      </Small>
      {command.message && (
        <div role="alert">
          <Banner tone="bad">{command.message}</Banner>
        </div>
      )}
      <span>
        {command.pending ? (
          <Button type="button" disabled={command.busy} onClick={() => void retry()}>
            Retry exact dismissal
          </Button>
        ) : (
          <Button type="submit" disabled={disabled || command.busy}>
            Dismiss with this reason
          </Button>
        )}{' '}
        <Button
          type="button"
          disabled={command.busy}
          onClick={() => {
            command.discard()
            onCancel()
          }}
        >
          Cancel
        </Button>
      </span>
    </Form>
  )
}
