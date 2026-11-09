import { useRef, useState } from 'react'
import { AiMark, Banner, Small, Button } from '#/components/ui'
import { Form, Label, TextArea } from '#/forms'
import { useForm } from 'react-hook-form'
import type { CaptureSnapshotDto, OperatorReviewDto } from '@invimport/contracts'
import type { OperatorReviewClient } from '#/operator/types'
import { useRetainedCommand } from '#/operator/useRetainedCommand'
import { useReportDirty } from '#/navigation/useReportDirty'

const MAX_INSTRUCTION_LENGTH = 8192

interface FormProps {
  batch: CaptureSnapshotDto
  review: OperatorReviewDto
  client: OperatorReviewClient
  groupId: string | null
  label: string
  disabled: boolean
  reload: () => Promise<void>
  onDirtyChange: (dirty: boolean) => void
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
  // The saved text when the form opened, then the text of each confirmed save.
  const [savedText, setSavedText] = useState(latest?.text ?? '')
  const {
    register,
    handleSubmit,
    reset,
    getValues,
    formState: { errors, isDirty },
  } = useForm({ defaultValues: { text: savedText } })
  const command = useRetainedCommand((input: { text: string; revision: string }, key: string) =>
    client.instruct(
      batch.id,
      { expected_revision: input.revision, group_id: groupId, text: input.text },
      key,
    ),
  )

  useReportDirty(isDirty || command.pending, onDirtyChange)

  async function finish(result: unknown) {
    if (result) {
      const confirmed = getValues('text')
      setSavedText(confirmed)
      reset({ text: confirmed })
      onDirtyChange(false)
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
      onChange={() => onDirtyChange(getValues('text') !== savedText || command.pending)}
      onSubmit={handleSubmit(save)}
      aria-label={`${label} instructions`}
    >
      <Label>
        <AiMark size="sm">{label}</AiMark>
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
          onDirtyChange(false)
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
