import { useEffect, useRef } from 'react'
import { Banner, Small, Button } from '#/components/ui'
import { Form, Label, TextArea } from '#/forms'
import { useForm } from 'react-hook-form'
import type { CaptureSnapshotDto, OperatorReviewDto } from '@invimport/contracts'
import type { OperatorReviewClient } from '#/operator/types'
import { useRetainedCommand } from '#/operator/useRetainedCommand'

const MAX_INSTRUCTION_LENGTH = 8192

interface FormProps {
  batch: CaptureSnapshotDto
  review: OperatorReviewDto
  client: OperatorReviewClient
  groupId: string | null
  label: string
  disabled: boolean
  reload: () => Promise<void>
  onDirtyChange: (key: string, dirty: boolean) => void
}

export function InstructionForm({
  batch,
  review,
  client,
  groupId,
  label,
  disabled,
  reload,
  onDirtyChange,
}: FormProps) {
  const revision = useRef(batch.revision)
  const latest = review.instructions.find((item) => item.group_id === groupId)
  const formKey = groupId ?? 'batch'
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm({ defaultValues: { text: latest?.text ?? '' } })
  const command = useRetainedCommand((input: { text: string; revision: string }, key: string) =>
    client.instruct(
      batch.id,
      { expected_revision: input.revision, group_id: groupId, text: input.text },
      key,
    ),
  )

  useEffect(() => {
    onDirtyChange(formKey, isDirty || command.pending)
  }, [formKey, isDirty, command.pending, onDirtyChange])

  async function finish(result: unknown) {
    if (result) {
      onDirtyChange(formKey, false)
      await reload()
    }
  }

  async function save(values: { text: string }) {
    await finish(await command.submit({ text: values.text, revision: revision.current }))
  }

  async function retry() {
    await finish(await command.retry())
  }

  return (
    <Form
      onChange={() => onDirtyChange(formKey, true)}
      onSubmit={handleSubmit(save)}
      aria-label={`${label} instructions`}
    >
      <Label>
        {label}
        <TextArea
          disabled={disabled || command.pending}
          maxLength={MAX_INSTRUCTION_LENGTH * 2}
          {...register('text', {
            validate: (value) =>
              [...value].length <= MAX_INSTRUCTION_LENGTH || 'At most 8192 characters.',
          })}
        />
      </Label>
      {errors.text && <Small role="alert">{errors.text.message}</Small>}
      <Small>
        {latest
          ? `Version ${latest.version} · ${new Date(latest.created_at).toLocaleString()}`
          : 'No instructions saved yet.'}
      </Small>
      {command.message && (
        <div role="alert">
          <Banner tone="bad">{command.message}</Banner>
        </div>
      )}
      <Button
        type="button"
        disabled={command.busy || (!isDirty && !command.pending)}
        onClick={() => {
          command.discard()
          reset()
          onDirtyChange(formKey, false)
        }}
      >
        Discard instruction edits
      </Button>
      {command.pending ? (
        <Button type="button" disabled={command.busy} onClick={() => void retry()}>
          Retry exact save
        </Button>
      ) : (
        <Button type="submit" disabled={disabled || command.busy || !isDirty}>
          Save {label.toLowerCase()}
        </Button>
      )}
    </Form>
  )
}
