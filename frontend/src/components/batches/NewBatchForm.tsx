import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import type { Client } from '../../capture/client'
import { Button, Form, Input, Label, Paragraph, TextArea } from '../ui/primitives'

type NewBatchValues = { title: string; note: string }
type NewBatchFormProps = {
  client: Client
  onDirtyChange: (dirty: boolean) => void
  onDiscard: () => void
}

export function NewBatchForm({ client, onDirtyChange, onDiscard }: NewBatchFormProps) {
  const { register, handleSubmit, getValues, reset, formState } = useForm<NewBatchValues>({
    defaultValues: { title: '', note: '' },
  })
  const [error, setError] = useState('')
  const createIntent = useRef({ payload: '', key: crypto.randomUUID() })

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
    const payload = JSON.stringify(input)
    if (createIntent.current.payload !== payload) {
      createIntent.current = { payload, key: crypto.randomUUID() }
    }
    setError('')

    try {
      const batch = await client.create(input, createIntent.current.key)
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
      <Button disabled={formState.isSubmitting}>Create retained batch</Button>
      {formState.isDirty && (
        <Button type="button" disabled={formState.isSubmitting} onClick={discardDraft}>
          Discard new batch input
        </Button>
      )}
    </Form>
  )
}
