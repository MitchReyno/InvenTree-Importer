import { useState } from 'react'
import { useForm } from 'react-hook-form'
import type { BatchCreate } from '@invimport/contracts/api'
import type { CaptureSnapshotDto } from '@invimport/contracts'
import { Paragraph, Button } from '#/components/ui'
import { Form, Input, Label, TextArea } from '#/forms'

type NewBatchValues = BatchCreate
type NewBatchFormProps = {
  create: (input: BatchCreate) => Promise<CaptureSnapshotDto>
  onDirtyChange: (dirty: boolean) => void
  onDiscard: () => void
}

export function NewBatchForm({ create, onDirtyChange, onDiscard }: NewBatchFormProps) {
  const { register, handleSubmit, getValues, reset, formState } = useForm<NewBatchValues>({
    defaultValues: { title: '', note: '' },
  })
  const [error, setError] = useState('')

  function reportDirty() {
    const { title, note } = getValues()
    onDirtyChange(Boolean(title || note))
  }

  function discardDraft() {
    reset()
    onDirtyChange(false)
    onDiscard()
  }

  async function createBatch(input: NewBatchValues) {
    setError('')

    try {
      const batch = await create(input)
      onDirtyChange(false)
      location.hash = batch.id
    } catch {
      setError(
        'Save could not be confirmed. Check the batch list before creating again; do not assume failure means nothing was saved.',
      )
    }
  }

  return (
    <Form onSubmit={handleSubmit(createBatch)}>
      {error && <Paragraph role="alert">{error}</Paragraph>}
      <Label>
        Batch title
        <Input
          required
          maxLength={256}
          placeholder="Bench bag · November"
          disabled={formState.isSubmitting}
          {...register('title', { onChange: reportDirty })}
        />
      </Label>
      <Label>
        Human note
        <TextArea
          disabled={formState.isSubmitting}
          maxLength={8192}
          placeholder="Where these components came from; observations, not inferred facts"
          {...register('note', { onChange: reportDirty })}
        />
      </Label>
      <Button type="submit" disabled={formState.isSubmitting}>
        Create retained batch
      </Button>
      {formState.isDirty && (
        <Button type="button" disabled={formState.isSubmitting} onClick={discardDraft}>
          Discard new batch input
        </Button>
      )}
    </Form>
  )
}
