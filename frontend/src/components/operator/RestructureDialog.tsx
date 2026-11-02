import { useEffect, useState } from 'react'
import { useFieldArray, useForm, type FieldErrors } from 'react-hook-form'
import styled from 'styled-components'
import type { CaptureSnapshotDto, OperatorImpactDto, RestructureDto } from '@invimport/contracts'
import type { OperatorReviewClient } from '../../operator/types'
import { classifyFailure, failureMessage } from '../../operator/command-failure'
import { useRetainedCommand } from '../../operator/useRetainedCommand'
import {
  Button,
  CheckboxLabel,
  ErrorNotice,
  Fieldset,
  Form,
  Input,
  Label,
  Paragraph,
  Select,
  Small,
} from '../ui/primitives'
import { ImpactSummary } from './ImpactSummary'
import { Modal } from './Modal'

export type RestructureKind = 'split' | 'merge' | 'move'

const QUANTITY_PATTERN = /^(?=.*[1-9])(0|[1-9][0-9]{0,12})(\.[0-9]{0,5}[1-9])?$/
const MAX_SPLIT_CHILDREN = 10

interface Values {
  children: { label: string; quantity: string }[]
  label: string
  quantity: string
  partId: string
  confirmed: boolean
  destination: 'existing' | 'new' | 'none'
  destinationPartId: string
  newPartLabel: string
}

interface Props {
  kind: RestructureKind
  batch: CaptureSnapshotDto
  lotIds: string[]
  /** Active lots outside this command, for the impact preview. */
  excludedLotIds: string[]
  client: OperatorReviewClient
  disabled: boolean
  reload: () => Promise<void>
  onClose: () => void
  onDirtyChange?: (dirty: boolean) => void
}

const TITLES: Record<RestructureKind, string> = {
  split: 'Split lot',
  merge: 'Merge lots',
  move: 'Move lots to a Part proposal',
}

function lotLabels(batch: CaptureSnapshotDto, ids: string[]) {
  return ids.map((id) => batch.lots.find((lot) => lot.id === id)?.label ?? id)
}

function defaults(batch: CaptureSnapshotDto, lotIds: string[]): Values {
  const first = batch.lots.find((lot) => lot.id === lotIds[0])
  const label = first?.label ?? 'Lot'
  return {
    children: [
      { label: `${label} · 1`, quantity: '' },
      { label: `${label} · 2`, quantity: '' },
    ],
    label: lotLabels(batch, lotIds).join(' + ').slice(0, 256),
    quantity: '',
    partId: first?.part_subject_id ?? '',
    confirmed: false,
    destination: 'existing',
    destinationPartId: batch.parts[0]?.id ?? '',
    newPartLabel: '',
  }
}

/** The exact change both the preview and the apply send; only `preview` differs. */
export function restructureChange(kind: RestructureKind, lotIds: string[], values: Values) {
  if (kind === 'split') {
    return {
      kind: 'split_lot' as const,
      lot_id: lotIds[0],
      children: values.children.map((child) => ({
        label: child.label.trim(),
        quantity: child.quantity.trim(),
      })),
    }
  }
  if (kind === 'merge') {
    return {
      kind: 'merge_lots' as const,
      lot_ids: lotIds,
      label: values.label.trim(),
      quantity: values.quantity.trim(),
      part_subject_id: values.partId || null,
      confirm_same_physical_contribution: true as const,
    }
  }
  return {
    kind: 'move_lots' as const,
    lot_ids: lotIds,
    destination: moveDestination(values),
  }
}

function moveDestination(
  values: Values,
): Extract<RestructureDto['change'], { kind: 'move_lots' }>['destination'] {
  if (values.destination === 'existing') {
    return { kind: 'existing', part_subject_id: values.destinationPartId }
  }
  if (values.destination === 'new') {
    return { kind: 'new', label: values.newPartLabel.trim() }
  }
  return { kind: 'none' }
}

export function RestructureDialog({
  kind,
  batch,
  lotIds,
  excludedLotIds,
  client,
  disabled,
  reload,
  onClose,
  onDirtyChange,
}: Props) {
  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors, isDirty },
  } = useForm<Values>({ defaultValues: defaults(batch, lotIds) })
  const children = useFieldArray({ control, name: 'children' })
  const [preview, setPreview] = useState<{
    change: RestructureDto['change']
    impact: OperatorImpactDto
  } | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [previewBusy, setPreviewBusy] = useState(false)
  const apply = useRetainedCommand((change: RestructureDto['change'], key: string) =>
    client.restructure(
      batch.id,
      { expected_revision: batch.revision, preview: false, change },
      key,
    ),
  )
  const destination = watch('destination')
  const locked = apply.busy || apply.pending

  useEffect(() => {
    onDirtyChange?.(isDirty || apply.pending)
  }, [isDirty, apply.pending, onDirtyChange])

  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  useEffect(() => {
    const subscription = watch(() => setPreview(null))
    return () => subscription.unsubscribe()
  }, [watch])

  async function runPreview(values: Values) {
    const change = restructureChange(kind, lotIds, values)
    setPreviewBusy(true)
    setPreviewError('')
    try {
      const result = await client.restructure(
        batch.id,
        { expected_revision: batch.revision, preview: true, change },
        crypto.randomUUID(),
      )
      setPreview({ change, impact: result.impact })
    } catch (error) {
      setPreviewError(failureMessage(classifyFailure(error)))
    } finally {
      setPreviewBusy(false)
    }
  }

  async function confirm() {
    if (!preview) {
      return
    }
    const result = await apply.submit(preview.change)
    if (result) {
      onDirtyChange?.(false)
      onClose()
      await reload()
    }
  }

  async function retryApply() {
    const result = await apply.retry()
    if (result) {
      onDirtyChange?.(false)
      onClose()
      await reload()
    }
  }

  const quantityRule = {
    validate: (value: string) =>
      QUANTITY_PATTERN.test(value.trim()) || 'Enter an exact positive quantity.',
  }
  const labelRule = {
    validate: (value: string) => value.trim().length > 0 || 'Give each lot a label.',
    maxLength: { value: 256, message: 'Labels are at most 256 characters.' },
  }

  return (
    <Modal title={TITLES[kind]} onClose={onClose} closeDisabled={locked}>
      <Paragraph>
        {kind === 'split' &&
          `Split ${lotLabels(batch, lotIds)[0]} into separate physical lots. The original is retired and kept as history.`}
        {kind === 'merge' &&
          `Merge ${lotLabels(batch, lotIds).join(', ')} into one physical lot. The originals are retired and kept as history.`}
        {kind === 'move' &&
          `Move ${lotLabels(batch, lotIds).join(', ')} to another Part proposal. Each lot stays a separate physical lot.`}
      </Paragraph>
      <Form onSubmit={handleSubmit(runPreview)}>
        <Fieldset disabled={disabled || locked}>
          {kind === 'split' && (
            <>
              {children.fields.map((field, index) => (
                <ChildRow key={field.id} aria-label={`New lot ${index + 1}`}>
                  <Label>
                    New lot {index + 1} label
                    <Input {...register(`children.${index}.label`, labelRule)} />
                  </Label>
                  <Label>
                    New lot {index + 1} quantity
                    <Input
                      inputMode="decimal"
                      {...register(`children.${index}.quantity`, quantityRule)}
                    />
                  </Label>
                  {children.fields.length > 2 && (
                    <Button type="button" onClick={() => children.remove(index)}>
                      Remove new lot {index + 1}
                    </Button>
                  )}
                </ChildRow>
              ))}
              <Button
                type="button"
                disabled={children.fields.length >= MAX_SPLIT_CHILDREN}
                onClick={() => children.append({ label: '', quantity: '' })}
              >
                Add another new lot
              </Button>
              <Small>
                Each new lot keeps the Part proposal and location choice, with its own exact
                quantity.
              </Small>
            </>
          )}
          {kind === 'merge' && (
            <>
              <Label>
                Merged lot label
                <Input {...register('label', labelRule)} />
              </Label>
              <Label>
                Merged lot quantity
                <Input inputMode="decimal" {...register('quantity', quantityRule)} />
              </Label>
              <Label>
                Part proposal
                <Select {...register('partId')}>
                  <option value="">No Part proposal</option>
                  {batch.parts.map((part) => (
                    <option key={part.id} value={part.id}>
                      {part.label}
                    </option>
                  ))}
                </Select>
              </Label>
              <CheckboxLabel>
                <Input
                  type="checkbox"
                  {...register('confirmed', {
                    validate: (value) =>
                      value || 'Confirm these rows are one physical contribution.',
                  })}
                />
                These are one physical contribution, not just the same Part
              </CheckboxLabel>
              <Small>
                If the lots had different locations, the merged lot uses the batch default until you
                choose one.
              </Small>
            </>
          )}
          {kind === 'move' && (
            <>
              <Label>
                Destination
                <Select {...register('destination')}>
                  <option value="existing">Existing Part proposal</option>
                  <option value="new">New Part proposal</option>
                  <option value="none">No Part proposal</option>
                </Select>
              </Label>
              {destination === 'existing' && (
                <Label>
                  Part proposal
                  <Select
                    {...register('destinationPartId', { required: 'Choose a Part proposal.' })}
                  >
                    {batch.parts.map((part) => (
                      <option key={part.id} value={part.id}>
                        {part.label}
                      </option>
                    ))}
                  </Select>
                </Label>
              )}
              {destination === 'new' && (
                <Label>
                  New Part proposal label
                  <Input {...register('newPartLabel', labelRule)} />
                </Label>
              )}
            </>
          )}
          <RestructureErrors errors={errors} />
          <Button type="submit" disabled={previewBusy}>
            Preview impact
          </Button>
        </Fieldset>
      </Form>
      {previewError && <ErrorNotice role="alert">{previewError}</ErrorNotice>}
      {preview && (
        <PreviewBox>
          <ImpactSummary
            batch={batch}
            impact={preview.impact}
            selectedLotIds={lotIds}
            excludedLotIds={excludedLotIds}
          />
          {apply.message && <ErrorNotice role="alert">{apply.message}</ErrorNotice>}
          {apply.pending ? (
            <span>
              <Button disabled={apply.busy} onClick={() => void retryApply()}>
                Retry exact change
              </Button>{' '}
              <Button disabled={apply.busy} onClick={apply.discard}>
                Discard unconfirmed change
              </Button>
            </span>
          ) : (
            <Button disabled={disabled || apply.busy} onClick={() => void confirm()}>
              Apply {TITLES[kind].toLowerCase()}
            </Button>
          )}
        </PreviewBox>
      )}
    </Modal>
  )
}

function RestructureErrors({ errors }: { errors: FieldErrors<Values> }) {
  const messages = new Set<string>()
  const childErrors = Array.isArray(errors.children) ? errors.children : []
  for (const child of childErrors) {
    if (child?.label?.message) {
      messages.add(child.label.message)
    }
    if (child?.quantity?.message) {
      messages.add(child.quantity.message)
    }
  }
  for (const field of [
    'label',
    'quantity',
    'confirmed',
    'destinationPartId',
    'newPartLabel',
  ] as const) {
    const message = errors[field]?.message
    if (message) {
      messages.add(message)
    }
  }
  if (!messages.size) {
    return null
  }
  return (
    <ErrorNotice role="alert">
      {[...messages].map((message) => (
        <Paragraph key={message}>{message}</Paragraph>
      ))}
    </ErrorNotice>
  )
}

const ChildRow = styled.fieldset`
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 10px;
  align-items: end;
  border: 1px solid #e3e8ef;
  border-radius: 6px;
  padding: 10px;
  @media (max-width: 600px) {
    grid-template-columns: 1fr;
  }
`
const PreviewBox = styled.section`
  margin-top: 14px;
  padding: 12px;
  border: 1px solid #b9cde7;
  background: #f4f8fe;
  border-radius: 6px;
`
