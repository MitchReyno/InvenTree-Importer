import { useCallback, useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useQuery } from '@tanstack/react-query'
import styled from 'styled-components'
import type { CaptureSnapshotDto, OperatorReviewDto } from '@invimport/contracts'
import type { MediaClient } from '../../media/types'
import type { OperatorReviewClient } from '../../operator/types'
import { useRetainedCommand } from '../../operator/useRetainedCommand'
import { serverQueryKey, useServerScope } from '../../queries/scope'
import { useRetainedPollInterval } from '../operations/LiveUpdates'
import { Button, ErrorNotice, Form, Label, Small, Subheading, TextArea } from '../ui/primitives'

const MAX_INSTRUCTION_LENGTH = 8192

interface Props {
  batch: CaptureSnapshotDto
  review: OperatorReviewDto
  client: OperatorReviewClient
  media?: MediaClient
  disabled: boolean
  reload: () => Promise<void>
  onDirtyChange: (dirty: boolean) => void
}

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

function InstructionForm({
  batch,
  review,
  client,
  groupId,
  label,
  disabled,
  reload,
  onDirtyChange,
}: FormProps) {
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
    await finish(await command.submit({ text: values.text, revision: batch.revision }))
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
          {...register('text', {
            maxLength: { value: MAX_INSTRUCTION_LENGTH, message: 'At most 8192 characters.' },
          })}
        />
      </Label>
      {errors.text && <Small role="alert">{errors.text.message}</Small>}
      <Small>
        {latest
          ? `Version ${latest.version} · ${new Date(latest.created_at).toLocaleString()}`
          : 'No instructions saved yet.'}
      </Small>
      {command.message && <ErrorNotice role="alert">{command.message}</ErrorNotice>}
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

/** Versioned human instructions for the batch and each evidence group. */
export function InstructionsPanel({
  batch,
  review,
  client,
  media,
  disabled,
  reload,
  onDirtyChange,
}: Props) {
  const pollInterval = useRetainedPollInterval()
  const scope = useServerScope()
  const mediaQuery = useQuery({
    queryKey: serverQueryKey(scope, 'media', batch.id),
    queryFn: () => media!.snapshot(batch.id),
    enabled: media !== undefined,
    refetchInterval: pollInterval,
  })
  const dirtyForms = useRef(new Set<string>())
  const [, setVersion] = useState(0)

  const reportDirty = useCallback(
    (key: string, dirty: boolean) => {
      const before = dirtyForms.current.size
      if (dirty) {
        dirtyForms.current.add(key)
      } else {
        dirtyForms.current.delete(key)
      }
      if (before !== dirtyForms.current.size) {
        setVersion((value) => value + 1)
        onDirtyChange(dirtyForms.current.size > 0)
      }
    },
    [onDirtyChange],
  )

  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  const groups = mediaQuery.data?.groups ?? []
  return (
    <Section aria-label="Instructions">
      <Subheading>Instructions</Subheading>
      <Small>
        Retained for research with each version. Current fixture-only Processing does not consume
        them.
      </Small>
      <InstructionForm
        batch={batch}
        review={review}
        client={client}
        groupId={null}
        label="Batch instructions"
        disabled={disabled || (dirtyForms.current.size > 0 && !dirtyForms.current.has('batch'))}
        reload={reload}
        onDirtyChange={reportDirty}
      />
      {groups.map((group) => (
        <InstructionForm
          key={group.id}
          batch={batch}
          review={review}
          client={client}
          groupId={group.id}
          label={`Group “${group.label}”`}
          disabled={disabled || (dirtyForms.current.size > 0 && !dirtyForms.current.has(group.id))}
          reload={reload}
          onDirtyChange={reportDirty}
        />
      ))}
    </Section>
  )
}

const Section = styled.section`
  display: grid;
  gap: 14px;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid #e3e8ef;
`
