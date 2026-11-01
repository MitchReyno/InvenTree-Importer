import { Button, Fieldset, Form, Input, Label, Select, Small, TextArea } from '../ui/primitives'
import { Controller, useForm } from 'react-hook-form'
import type { Snapshot, CaptureWorkspaceProps } from '../../capture/types'
import {
  captureEditorDefaults,
  captureEditorChange,
  type CaptureEditorValues,
} from '../../capture/editor-model'
import { QuantityField } from './QuantityField'
import { ReferenceField } from './ReferenceField'

type EditorProps = {
  batch: Snapshot
  selected: string
  frozen: boolean
  dirty: boolean
  onDirty: (value: boolean) => void
  edit: CaptureWorkspaceProps['edit']
  observe: CaptureWorkspaceProps['observe']
}

export function CaptureEditor({
  batch,
  selected,
  frozen,
  dirty,
  onDirty,
  edit,
  observe,
}: EditorProps) {
  const lot = batch.lots.find((l) => l.id === selected)
  const part = batch.parts.find((p) => p.id === selected)
  const defaults = selected === 'defaults'
  let labelCaption = 'Lot label'
  if (part || selected === 'add_part') {
    labelCaption = 'Part label'
  } else if (selected === 'batch') {
    labelCaption = 'Title'
  }

  // Defaults belong to this selected editor's lifetime. Polling does not reset human input.
  const { register, control, handleSubmit, formState } = useForm<CaptureEditorValues>({
    defaultValues: captureEditorDefaults(batch, selected),
  })

  function saveChanges(values: CaptureEditorValues) {
    return edit(captureEditorChange(batch, selected, values))
  }

  return (
    <Form onChange={() => onDirty(true)} onSubmit={handleSubmit(saveChanges)}>
      <Fieldset disabled={frozen || formState.isSubmitting}>
        {!defaults && selected !== 'note' && (
          <Label>
            {labelCaption}
            <Input required maxLength={256} {...register('label')} />
          </Label>
        )}
        {(lot || selected === 'add_lot') && (
          <Label>
            Shared Part proposal
            <Select {...register('partId')}>
              <option value="">Not linked yet</option>
              {batch.parts.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Label>
        )}
        {(defaults || lot) && (
          <>
            <Controller
              name="quantity"
              control={control}
              render={({ field }) => (
                <QuantityField value={field.value} defaults={defaults} onChange={field.onChange} />
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
                  defaults={defaults}
                  batch={batch}
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
        {part && (
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
                onChange={(value) => {
                  field.onChange(value)
                  onDirty(true)
                }}
                observe={observe}
              />
            )}
          />
        )}
        {selected === 'note' && (
          <Label>
            Note relates to
            <Select {...register('noteSubject')}>
              <option value="">Batch</option>
              {[...batch.parts, ...batch.lots].map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Label>
        )}
        {(selected === 'add_lot' || selected === 'note') && (
          <Label>
            Human observation / note
            <TextArea maxLength={8192} {...register('text')} />
          </Label>
        )}
        <Button disabled={frozen || (!dirty && !selected.startsWith('add_'))}>
          Save {defaults ? 'shared defaults' : 'human changes'}
        </Button>
        {!dirty && !frozen && !selected.startsWith('add_') && (
          <Small>Saved values are unchanged. Edit a field to save a new revision.</Small>
        )}
      </Fieldset>
      {dirty && (
        <Button
          type="button"
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
