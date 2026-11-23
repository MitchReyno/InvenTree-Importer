import { useState } from 'react'
import { Banner, media, Paragraph, Small, Button, Dialog } from '#/components/ui'
import { CheckboxLabel, Fieldset, Form, Input, Label, Select } from '#/forms'
import { useFieldArray, useForm, type FieldErrors } from 'react-hook-form'
import styled from 'styled-components'
import { color, radius, space } from '#/theme/generated/tokens'
import type { CaptureSnapshotDto, OperatorImpactDto, RestructureDto } from '@invimport/contracts'
import type { OperatorReviewClient } from '#/operator/types'
import { classifyFailure, failureMessage } from '#/operator/command-failure'
import { useRetainedCommand } from '#/operator/useRetainedCommand'
import { ImpactSummary } from './ImpactSummary'
import { observationNames } from './observation-names'
import { useReportDirty } from '#/navigation/useReportDirty'
import { useDraftGeneration } from '#/operator/useDraftGeneration'

export type RestructureKind = 'split' | 'merge' | 'move'

const QUANTITY_PATTERN = /^(?=.*[1-9])(0|[1-9][0-9]{0,12})(\.[0-9]{0,5}[1-9])?$/
const MAX_SPLIT_CHILDREN = 10

interface Values {
  /** `key` is stable across removals, so an observation's choice follows its new lot. */
  children: { key: string; label: string; quantity: string }[]
  /** Split only: which new lot (by key) each of the lot's observations goes to. */
  observations: { id: string; child: string }[]
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
      { key: 'child-1', label: `${label} · 1`, quantity: '' },
      { key: 'child-2', label: `${label} · 2`, quantity: '' },
    ],
    // Every observation goes somewhere, so a split never strands one on the retired lot.
    observations: (first?.evidence_observation_ids ?? []).map((id) => ({
      id,
      child: 'child-1',
    })),
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
      children: values.children.map((child, index) => {
        // A removed new lot's observations fall back to the first one.
        const ids = values.observations
          .filter((item) => {
            const target = values.children.findIndex((entry) => entry.key === item.child)
            return Math.max(target, 0) === index
          })
          .map((item) => item.id)
        return {
          label: child.label.trim(),
          quantity: child.quantity.trim(),
          ...(ids.length ? { observation_ids: ids } : {}),
        }
      }),
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
  // The dialog's baseline, compared with the form on every change the operator makes.
  const [initial] = useState(() => defaults(batch, lotIds))
  const {
    register,
    control,
    handleSubmit,
    watch,
    getValues,
    formState: { errors, isDirty },
  } = useForm<Values>({ defaultValues: initial })
  const children = useFieldArray({ control, name: 'children' })
  const splitObservations = kind === 'split' ? defaults(batch, lotIds).observations : []
  const names = observationNames(batch.evidence_observations ?? [])
  const childLabels = watch('children')
  const [preview, setPreview] = useState<{
    change: RestructureDto['change']
    impact: OperatorImpactDto
    revision: string
  } | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [previewBusy, setPreviewBusy] = useState(false)
  // Apply sends the revision the preview described, so a retry stays byte-identical.
  const apply = useRetainedCommand(
    (input: { change: RestructureDto['change']; revision: string }, key: string) =>
      client.restructure(
        batch.id,
        { expected_revision: input.revision, preview: false, change: input.change },
        key,
      ),
  )
  const destination = watch('destination')
  const locked = apply.busy || apply.pending

  // Field-array rows and the retained command change without a native change event.
  function reportDraft() {
    onDirtyChange?.(
      JSON.stringify(getValues()) !== JSON.stringify(initial) || apply.hasPendingIntent(),
    )
  }

  useReportDirty(isDirty || apply.pending, onDirtyChange)

  // Any edit makes the shown preview stale.
  const draftGeneration = useDraftGeneration(watch, () => setPreview(null))

  async function runPreview(values: Values) {
    const change = restructureChange(kind, lotIds, values)
    const generation = draftGeneration.current
    setPreviewBusy(true)
    setPreviewError('')
    try {
      const result = await client.restructure(
        batch.id,
        { expected_revision: batch.revision, preview: true, change },
        crypto.randomUUID(),
      )
      if (generation === draftGeneration.current) {
        setPreview({ change, impact: result.impact, revision: batch.revision })
      }
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
    onDirtyChange?.(true)
    const result = await apply.submit({ change: preview.change, revision: preview.revision })
    if (result) {
      onDirtyChange?.(false)
      onClose()
      await reload()
      return
    }
    // A refusal releases the retained intent, so an unedited dialog is clean again.
    reportDraft()
  }

  async function retryApply() {
    const result = await apply.retry()
    if (result) {
      onDirtyChange?.(false)
      onClose()
      await reload()
      return
    }
    reportDraft()
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
    <Dialog title={TITLES[kind]} onClose={onClose} closeDisabled={locked || isDirty}>
      <Paragraph>
        {kind === 'split' &&
          `Split ${lotLabels(batch, lotIds)[0]} into separate physical lots. The original is retired and kept as history.`}
        {kind === 'merge' &&
          `Merge ${lotLabels(batch, lotIds).join(', ')} into one physical lot. The originals are retired and kept as history.`}
        {kind === 'move' &&
          `Move ${lotLabels(batch, lotIds).join(', ')} to another Part proposal. Each lot stays a separate physical lot.`}
      </Paragraph>
      <Button
        type="button"
        disabled={locked || !isDirty}
        onClick={() => {
          onDirtyChange?.(false)
          onClose()
        }}
      >
        Discard restructure edits
      </Button>
      <Form onChange={reportDraft} onSubmit={handleSubmit(runPreview)}>
        <Fieldset disabled={disabled || locked || previewBusy}>
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
                    <Button
                      type="button"
                      onClick={() => {
                        children.remove(index)
                        reportDraft()
                      }}
                    >
                      Remove new lot {index + 1}
                    </Button>
                  )}
                </ChildRow>
              ))}
              <Button
                type="button"
                disabled={children.fields.length >= MAX_SPLIT_CHILDREN}
                onClick={() => {
                  children.append({ key: crypto.randomUUID(), label: '', quantity: '' })
                  reportDraft()
                }}
              >
                Add another new lot
              </Button>
              {splitObservations.length > 0 && (
                <Fieldset>
                  <legend>Where each observation goes</legend>
                  {splitObservations.map((observation, index) => (
                    <Label key={observation.id}>
                      Observation: {names.get(observation.id) ?? 'unread item'}
                      <Select {...register(`observations.${index}.child`)}>
                        {children.fields.map((child, childIndex) => (
                          <option key={child.id} value={child.key}>
                            New lot {childIndex + 1}
                            {childLabels[childIndex]?.label
                              ? `: ${childLabels[childIndex].label}`
                              : ''}
                          </option>
                        ))}
                      </Select>
                    </Label>
                  ))}
                </Fieldset>
              )}
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
      {previewError && (
        <div role="alert">
          <Banner tone="bad">{previewError}</Banner>
        </div>
      )}
      {preview && (
        <PreviewBox>
          <ImpactSummary
            batch={batch}
            impact={preview.impact}
            selectedLotIds={lotIds}
            excludedLotIds={excludedLotIds}
          />
          {apply.message && (
            <div role="alert">
              <Banner tone="bad">{apply.message}</Banner>
            </div>
          )}
          {apply.pending ? (
            <span>
              <Button disabled={apply.busy} onClick={() => void retryApply()}>
                Retry exact change
              </Button>{' '}
              <Button
                disabled={apply.busy}
                onClick={() => {
                  apply.discard()
                  reportDraft()
                }}
              >
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
    </Dialog>
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
    <div role="alert">
      <Banner tone="bad">
        {[...messages].map((message) => (
          <Paragraph key={message}>{message}</Paragraph>
        ))}
      </Banner>
    </div>
  )
}

const ChildRow = styled.fieldset`
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: ${space[5]};
  align-items: end;
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  padding: ${space[5]};
  ${media.narrow} {
    grid-template-columns: 1fr;
  }
`
const PreviewBox = styled.section`
  margin-top: ${space[7]};
  padding: ${space[6]};
  border: 1px solid ${color.lineStrong};
  background: ${color.accentWeak};
  border-radius: ${radius.card};
`
