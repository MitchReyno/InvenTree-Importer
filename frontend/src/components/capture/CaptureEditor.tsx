import { Small, Button, SegmentedControl } from '#/components/ui'
import { ChoicePicker, Fieldset, Form, Input, Label, TextArea } from '#/forms'
import { Controller, useForm } from 'react-hook-form'
import type { Snapshot } from '#/capture/types'
import {
  captureEditorDefaults,
  captureEditorChange,
  type CaptureEditorValues,
} from '#/capture/editor-model'
import { CaptureContextFields } from './CaptureContextFields'
import { CaptureContextSummary } from './CaptureContextSummary'
import { PartCreationFields } from './PartCreationFields'
import { QuantityField } from './QuantityField'
import { AssignedLocationField } from './AssignedLocationField'
import { ReferenceField } from './ReferenceField'
import type { CaptureEdit } from '#/capture/types'
import { useBatchCommands } from '#/context'

type EditorProps = {
  batch: Snapshot
  selected: string
  frozen: boolean
  dirty: boolean
  onDirty: (value: boolean) => void
  edit: CaptureEdit
}

const PART_ACTIONS = [
  { id: 'reuse', label: 'Reuse a Part' },
  { id: 'create', label: 'Create a Part' },
]

export function CaptureEditor({ batch, selected, frozen, dirty, onDirty, edit }: EditorProps) {
  const { observe } = useBatchCommands()
  const lot = batch.lots.find((l) => l.id === selected)
  const part = batch.parts.find((p) => p.id === selected)
  let labelCaption = 'Lot label'
  if (part || selected === 'add_part') {
    labelCaption = 'Part label'
  }

  // Defaults belong to this selected editor's lifetime. Polling does not reset human input.
  const { register, control, handleSubmit, formState, watch } = useForm<CaptureEditorValues>({
    defaultValues: captureEditorDefaults(batch, selected),
  })

  // The fieldset disables native inputs; the pickers take it as a prop.
  const locked = frozen || formState.isSubmitting

  function saveChanges(values: CaptureEditorValues) {
    return edit(captureEditorChange(batch, selected, values))
  }

  return (
    <Form onChange={() => onDirty(true)} onSubmit={handleSubmit(saveChanges)}>
      <Fieldset disabled={locked}>
        <Label>
          {labelCaption}
          <Input required maxLength={256} {...register('label')} />
        </Label>
        {(lot || selected === 'add_lot') && (
          <Controller
            name="partId"
            control={control}
            render={({ field }) => (
              <ChoicePicker
                label="Shared Part proposal"
                noun="Part proposals"
                placeholder="Choose a Part proposal…"
                choices={[
                  { value: '', label: 'Not linked yet' },
                  ...batch.parts.map((p) => ({ value: p.id, label: p.label })),
                ]}
                value={field.value}
                disabled={locked}
                onChange={(value) => {
                  field.onChange(value)
                  onDirty(true)
                }}
              />
            )}
          />
        )}
        {lot && (
          <>
            <Controller
              name="quantity"
              control={control}
              render={({ field }) => (
                <QuantityField value={field.value} defaults={false} onChange={field.onChange} />
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
                  defaults={false}
                  batch={batch}
                  disabled={locked}
                  onChange={(value) => {
                    field.onChange(value)
                    onDirty(true)
                  }}
                  observe={observe}
                />
              )}
            />
          </>
        )}
        {lot && (
          <>
            <CaptureContextSummary batch={batch} subjectId={lot.id} />
            <Controller
              name="captureContext"
              control={control}
              render={({ field }) => (
                <CaptureContextFields
                  value={field.value}
                  defaults={false}
                  batch={batch}
                  disabled={locked}
                  observe={observe}
                  onChange={(value) => {
                    field.onChange(value)
                    onDirty(true)
                  }}
                />
              )}
            />
          </>
        )}
        {part && (
          <Controller
            name="partLocation"
            control={control}
            render={({ field }) => (
              <AssignedLocationField
                label="Location for this Part's lots"
                scope="Applies to linked lots that use the batch default. A lot's own location still wins; this is not an inventory Part field."
                value={field.value.mode === 'unset' ? undefined : field.value}
                batch={batch}
                disabled={locked}
                onChange={(value) => {
                  field.onChange(value)
                  onDirty(true)
                }}
              />
            )}
          />
        )}
        {part && (
          <Controller
            name="partMode"
            control={control}
            render={({ field }) => (
              <Label as="div">
                Part action
                <SegmentedControl
                  label="Part action"
                  options={PART_ACTIONS}
                  value={field.value}
                  onChange={(id) => {
                    const next = id === 'create' ? 'create' : 'reuse'
                    if (next !== field.value) {
                      field.onChange(next)
                      onDirty(true)
                    }
                  }}
                />
              </Label>
            )}
          />
        )}
        {part && watch('partMode') === 'create' && (
          <PartCreationFields
            batch={batch}
            control={control}
            register={register}
            disabled={locked}
            observe={observe}
            onDirty={() => onDirty(true)}
          />
        )}
        {part && watch('partMode') === 'reuse' && (
          <Controller
            name="choice"
            control={control}
            render={({ field }) => (
              <ReferenceField
                title="Existing Part"
                model="part"
                value={field.value}
                defaults
                batch={batch}
                disabled={locked}
                onChange={(value) => {
                  field.onChange(value)
                  onDirty(true)
                }}
                observe={observe}
              />
            )}
          />
        )}
        {selected === 'add_lot' && (
          <Label>
            Human observation / note
            <TextArea maxLength={8192} {...register('text')} />
          </Label>
        )}
        <Button type="submit" disabled={frozen || (!dirty && !selected.startsWith('add_'))}>
          Save human changes
        </Button>
        {!dirty && !frozen && !selected.startsWith('add_') && (
          <Small>Saved values are unchanged. Edit a field to save a new revision.</Small>
        )}
      </Fieldset>
      {dirty && (
        <Button
          type="button"
          disabled={formState.isSubmitting}
          onClick={() => {
            onDirty(false)
            /* Remount through explicit reset rather than silently dropping stale values. */ locationReload()
          }}
        >
          Discard unsaved input
        </Button>
      )}
    </Form>
  )
}

function locationReload() {
  window.location.reload()
}
