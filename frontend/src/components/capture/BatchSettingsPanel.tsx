import { Controller, useForm } from 'react-hook-form'
import styled from 'styled-components'
import { validate, type CaptureContextDto, type CaptureEditDto } from '@invimport/contracts'
import type { CaptureWorkspaceProps, Quantity, Reference, Snapshot } from '../../capture/types'
import { batchContext } from '../../capture/context'
import {
  Button,
  ErrorNotice,
  Fieldset,
  Form,
  Heading,
  Input,
  Label,
  Panel,
  Paragraph,
  Small,
  Select,
  TextArea,
} from '../ui/primitives'
import { QuantityField } from './QuantityField'
import { ReferenceField } from './ReferenceField'
import { CaptureContextFields } from './CaptureContextFields'
import { CaptureContextSummary } from './CaptureContextSummary'

type Values = {
  title: string
  quantity: Quantity
  location: Reference
  context: CaptureContextDto
  note: string
  noteSubject: string
}
type Props = Pick<CaptureWorkspaceProps, 'edit' | 'observe' | 'reload'> & {
  batch: Snapshot
  disabled: boolean
  dirty: boolean
  onDirty: (dirty: boolean) => void
  noteRef: React.RefObject<HTMLTextAreaElement | null>
}

function defaults(batch: Snapshot): Values {
  return {
    title: batch.title,
    quantity: batch.defaults.quantity,
    location: batch.defaults.location,
    context: batchContext(batch),
    note: '',
    noteSubject: '',
  }
}

export function BatchSettingsPanel({
  batch,
  disabled,
  dirty,
  onDirty,
  edit,
  observe,
  noteRef,
  reload,
}: Props) {
  const { register, control, handleSubmit, reset, setError, clearErrors, formState } =
    useForm<Values>({
      defaultValues: defaults(batch),
    })
  const note = register('note')

  async function save(values: Values) {
    const tags = values.context.tags
    const context = {
      ...values.context,
      tags:
        tags.mode === 'set'
          ? { mode: 'set' as const, value: tags.value.map((tag) => tag.trim()).filter(Boolean) }
          : tags,
    }
    const change: CaptureEditDto['change'] = {
      kind: 'settings',
      title: values.title,
      quantity: values.quantity,
      location: values.location,
      context,
      ...(values.note
        ? {
            note: values.note,
            ...(values.noteSubject ? { note_subject_id: values.noteSubject } : {}),
          }
        : {}),
    }
    try {
      validate('CaptureEdit', { expected_revision: batch.revision, change })
    } catch {
      setError('root', {
        message:
          'Check the title, calendar date, exact quantity and mapped selections. Tags must be distinct, with at most 32 tags of 100 characters each.',
      })
      return
    }
    clearErrors('root')
    await edit(change)
  }

  return (
    <Settings role="region" aria-labelledby="batch-settings-title" data-area="settings">
      <Heading id="batch-settings-title">Batch settings</Heading>
      <Paragraph>
        Shared defaults apply to inherited fields only. Explicit lot choices, unknowns and clears
        stay unchanged.
      </Paragraph>
      <Form onChange={() => onDirty(true)} onSubmit={handleSubmit(save)}>
        {formState.errors.root && (
          <ErrorNotice role="alert">{formState.errors.root.message}</ErrorNotice>
        )}
        <Fieldset disabled={disabled || formState.isSubmitting}>
          <Fields>
            <Label>
              Batch title
              <Input required maxLength={256} {...register('title')} />
            </Label>
            <Controller
              name="quantity"
              control={control}
              render={({ field }) => (
                <QuantityField
                  value={field.value}
                  defaults
                  onChange={(value) => {
                    field.onChange(value)
                    onDirty(true)
                  }}
                />
              )}
            />
            <Controller
              name="location"
              control={control}
              render={({ field }) => (
                <ReferenceField
                  title="Location"
                  model="location"
                  value={field.value}
                  defaults
                  batch={batch}
                  onChange={(value) => {
                    field.onChange(value)
                    onDirty(true)
                  }}
                  observe={observe}
                />
              )}
            />
            <Controller
              name="context"
              control={control}
              render={({ field }) => (
                <CaptureContextFields
                  value={field.value}
                  defaults
                  batch={batch}
                  observe={observe}
                  onChange={(value) => {
                    field.onChange(value)
                    onDirty(true)
                  }}
                />
              )}
            />
            <Label>
              Note relates to
              <Select {...register('noteSubject')}>
                <option value="">Batch</option>
                {[...batch.parts, ...batch.lots].map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.label}
                  </option>
                ))}
              </Select>
            </Label>
            <Label>
              Batch human note
              <TextArea
                maxLength={8192}
                {...note}
                ref={(element) => {
                  note.ref(element)
                  noteRef.current = element
                }}
              />
              <Small>
                Append a human observation to the selected batch, Part or physical lot in the same
                settings save.
              </Small>
            </Label>
          </Fields>
          <Button disabled={disabled || !dirty}>Save Batch settings</Button>
        </Fieldset>
        {dirty && (
          <Button
            type="button"
            disabled={formState.isSubmitting}
            onClick={() => {
              if (reload) {
                void reload()
              } else {
                reset(defaults(batch))
                onDirty(false)
              }
            }}
          >
            Discard Batch settings edits
          </Button>
        )}
      </Form>
      <Unavailable>
        <legend>Purchase order · unavailable</legend>
        <Label>
          <input type="checkbox" disabled />
          Create a purchase order in InvenTree
        </Label>
        <Paragraph>
          Purchase-order creation is not yet available. These controls are disabled and no
          purchase-order request is saved or sent.
        </Paragraph>
      </Unavailable>
      <details open>
        <summary>Saved lot inheritance and overrides · {batch.lots.length} physical lots</summary>
        {batch.lots.map((lot) => (
          <div key={lot.id}>
            <strong>{lot.label}</strong>
            <CaptureContextSummary batch={batch} subjectId={lot.id} />
            <Small>
              Quantity: {lot.quantity.mode} · Location:{' '}
              {lot.location.mode === 'inherit' ? 'Inherited' : 'Override'} · {lot.location.mode}
            </Small>
          </div>
        ))}
      </details>
    </Settings>
  )
}

const Settings = styled(Panel)`
  grid-area: settings;
  min-width: 0;
  details {
    margin-top: 12px;
    overflow-wrap: anywhere;
  }
`
const Fields = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 245px), 1fr));
  gap: 12px;
  align-items: start;
`
const Unavailable = styled.fieldset`
  margin: 16px 0;
  padding: 12px;
  color: #526179;
  background: #eef0f3;
  border: 1px solid #cbd2dc;
  border-radius: 5px;
`
