import { useState } from 'react'
import { Banner, Panel, Paragraph, Small, Button, useConfirmation } from '#/components/ui'
import { Fieldset, Form, Input, Label, Select } from '#/forms'
import { useForm } from 'react-hook-form'
import styled from 'styled-components'
import { color, radius, space } from '#/theme/generated/tokens'
import type { BulkEditDto, CaptureSnapshotDto, OperatorImpactDto } from '@invimport/contracts'
import type { OperatorReviewClient } from '#/operator/types'
import { classifyFailure, failureMessage } from '#/operator/command-failure'
import { useRetainedCommand } from '#/operator/useRetainedCommand'
import { ImpactSummary } from './ImpactSummary'
import { useReportDirty } from '#/navigation/useReportDirty'
import { useDraftGeneration } from '#/operator/useDraftGeneration'

const QUANTITY_PATTERN = /^(?=.*[1-9])(0|[1-9][0-9]{0,12})(\.[0-9]{0,5}[1-9])?$/

type QuantityMode = 'keep' | 'set' | 'inherit' | 'unknown' | 'clear' | 'unset'

interface Values {
  quantityMode: QuantityMode
  quantity: string
  /** `keep`, `mode:<inherit|clear|unknown|unset>` or `observation:<id>`. */
  location: string
}

type BulkChange = BulkEditDto['change']

const DEFAULTS: Values = { quantityMode: 'keep', quantity: '', location: 'keep' }

function differsFromDefaults(values: Values) {
  return (Object.keys(DEFAULTS) as (keyof Values)[]).some((key) => values[key] !== DEFAULTS[key])
}

interface Props {
  batch: CaptureSnapshotDto
  selectedIds: string[]
  activeLotIds: string[]
  client: OperatorReviewClient
  disabled: boolean
  reload: () => Promise<void>
  onDirtyChange?: (dirty: boolean) => void
}

/** Only named fields change; "Keep" sends nothing for that field. */
export function bulkChange(batch: CaptureSnapshotDto, values: Values): BulkChange | null {
  const change: BulkChange = {}
  if (values.quantityMode === 'set') {
    change.quantity = { mode: 'set', value: values.quantity.trim() }
  } else if (values.quantityMode !== 'keep') {
    change.quantity = { mode: values.quantityMode }
  }
  if (values.location.startsWith('mode:')) {
    change.location = {
      mode: values.location.slice('mode:'.length) as 'inherit' | 'clear' | 'unknown' | 'unset',
    }
  } else if (values.location.startsWith('observation:')) {
    const observation = batch.observations.find(
      (item) => item.id === values.location.slice('observation:'.length),
    )
    if (observation) {
      change.location = {
        mode: 'set',
        value: {
          observation_id: observation.id,
          target_context_id: observation.target_context_id,
          model: 'location',
          pk: observation.pk,
        },
      }
    }
  }
  return change.quantity || change.location ? change : null
}

export function BulkEditPanel({
  batch,
  selectedIds,
  activeLotIds,
  client,
  disabled,
  reload,
  onDirtyChange,
}: Props) {
  const {
    register,
    handleSubmit,
    watch,
    reset,
    getValues,
    formState: { errors, isDirty },
  } = useForm<Values>({ defaultValues: DEFAULTS })
  const [retainedPreview, setPreview] = useState<{
    lotIds: string[]
    change: BulkChange
    impact: OperatorImpactDto
    /** The revision the preview described; apply sends exactly this revision. */
    revision: string
  } | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [previewBusy, setPreviewBusy] = useState(false)
  const confirm = useConfirmation()
  const apply = useRetainedCommand(
    (input: { lotIds: string[]; change: BulkChange; revision: string }, key: string) =>
      client.bulkEdit(
        batch.id,
        {
          expected_revision: input.revision,
          preview: false,
          lot_ids: input.lotIds,
          change: input.change,
        },
        key,
      ),
  )
  const quantityMode = watch('quantityMode')
  const locations = batch.observations.filter((item) => item.model === 'location')
  const locked = apply.busy || apply.pending
  const selectionKey = selectedIds.join(',')
  // A different selection invalidates the shown preview; a pending exact intent keeps it.
  const preview =
    retainedPreview && (locked || retainedPreview.lotIds.join(',') === selectionKey)
      ? retainedPreview
      : null

  useReportDirty(isDirty || apply.pending, onDirtyChange)

  // Any edit makes the shown preview stale.
  const draftGeneration = useDraftGeneration(watch, () => setPreview(null))

  async function runPreview(values: Values) {
    const change = bulkChange(batch, values)
    if (!change) {
      setPreviewError('Choose at least one field to change.')
      return
    }
    const lotIds = [...selectedIds]
    const generation = draftGeneration.current
    setPreviewBusy(true)
    setPreviewError('')
    try {
      const result = await client.bulkEdit(
        batch.id,
        { expected_revision: batch.revision, preview: true, lot_ids: lotIds, change },
        crypto.randomUUID(),
      )
      if (generation === draftGeneration.current) {
        setPreview({ lotIds, change, impact: result.impact, revision: batch.revision })
      }
    } catch (error) {
      setPreviewError(failureMessage(classifyFailure(error)))
    } finally {
      setPreviewBusy(false)
    }
  }

  async function finish(result: unknown, count: number) {
    if (result) {
      // The applied change is done; the panel starts again from "Keep".
      reset()
      setPreview(null)
      onDirtyChange?.(false)
      // An applied bulk edit has no inverse command, so the confirmation offers no Undo.
      confirm(`Applied to ${count} lot${count === 1 ? '' : 's'}`)
      await reload()
    }
  }

  return (
    <Panel aria-label="Bulk edit selected lots">
      <Paragraph>
        <strong>{selectedIds.length} selected</strong> · bulk edits apply to every selected lot or
        to none.
      </Paragraph>
      <Button
        type="button"
        disabled={locked || !isDirty}
        onClick={() => {
          reset()
          setPreview(null)
          apply.discard()
          onDirtyChange?.(false)
        }}
      >
        Discard bulk edits
      </Button>
      <Form
        onChange={() => onDirtyChange?.(differsFromDefaults(getValues()) || apply.pending)}
        onSubmit={handleSubmit(runPreview)}
      >
        <Row disabled={disabled || locked || previewBusy || !selectedIds.length}>
          <Label>
            Quantity
            <Select {...register('quantityMode')}>
              <option value="keep">Keep each lot's value</option>
              <option value="set">Set exact quantity</option>
              <option value="inherit">Use batch default</option>
              <option value="unknown">Explicitly unknown</option>
              <option value="clear">Explicitly cleared</option>
              <option value="unset">Not selected</option>
            </Select>
          </Label>
          {quantityMode === 'set' && (
            <Label>
              Exact pieces for every selected lot
              <Input
                inputMode="decimal"
                aria-invalid={errors.quantity ? true : undefined}
                {...register('quantity', {
                  validate: (value) =>
                    QUANTITY_PATTERN.test(value.trim()) || 'Enter an exact positive quantity.',
                })}
              />
            </Label>
          )}
          <Label>
            Location
            <Select {...register('location')}>
              <option value="keep">Keep each lot's value</option>
              <option value="mode:inherit">Use batch default</option>
              <option value="mode:clear">No location (explicit)</option>
              <option value="mode:unknown">Explicitly unknown</option>
              <option value="mode:unset">Not selected</option>
              {locations.map((item) => (
                <option key={item.id} value={`observation:${item.id}`}>
                  {item.label} (#{item.pk})
                </option>
              ))}
            </Select>
          </Label>
          <Button type="submit" disabled={previewBusy}>
            Preview bulk edit
          </Button>
        </Row>
      </Form>
      {errors.quantity && <Small role="alert">{errors.quantity.message}</Small>}
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
            selectedLotIds={preview.lotIds}
            excludedLotIds={activeLotIds.filter((id) => !preview.lotIds.includes(id))}
          />
          {apply.message && (
            <div role="alert">
              <Banner tone="bad">{apply.message}</Banner>
            </div>
          )}
          {apply.pending ? (
            <span>
              <Button
                disabled={apply.busy}
                onClick={() =>
                  void apply.retry().then((result) => finish(result, preview.lotIds.length))
                }
              >
                Retry exact bulk edit
              </Button>{' '}
              <Button disabled={apply.busy} onClick={apply.discard}>
                Discard unconfirmed bulk edit
              </Button>
            </span>
          ) : (
            <Button
              disabled={disabled || apply.busy}
              onClick={() =>
                void apply
                  .submit({
                    lotIds: preview.lotIds,
                    change: preview.change,
                    revision: preview.revision,
                  })
                  .then((result) => finish(result, preview.lotIds.length))
              }
            >
              Apply to {preview.lotIds.length} lot{preview.lotIds.length === 1 ? '' : 's'}
            </Button>
          )}
        </PreviewBox>
      )}
    </Panel>
  )
}

const Row = styled(Fieldset)`
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  align-items: end;
`
const PreviewBox = styled.section`
  margin-top: ${space[7]};
  padding: ${space[6]};
  border: 1px solid ${color.lineStrong};
  background: ${color.accentWeak};
  border-radius: ${radius.card};
`
