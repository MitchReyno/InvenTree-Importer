import type { Control, UseFormRegister } from 'react-hook-form'
import { Controller, useFieldArray } from 'react-hook-form'
import type { CaptureObservationDto } from '@invimport/contracts'
import type { CaptureEditorValues } from '#/capture/editor-model'
import type { Snapshot } from '#/capture/types'
import { Small, Button } from '#/components/ui'
import { ChoicePicker, Input, Label, Field, type PickerChoice } from '#/forms'
import { MappingReader } from './MappingReader'
import type { CaptureObserve } from '#/capture/types'

interface Props {
  batch: Snapshot
  control: Control<CaptureEditorValues>
  register: UseFormRegister<CaptureEditorValues>
  /** Set by the enclosing form, whose fieldset doesn't reach the pickers. */
  disabled: boolean
  observe: CaptureObserve
  onDirty: () => void
}

/** The batch's observed records that `include` accepts, as picker choices. */
function observed(
  batch: Snapshot,
  include: (item: CaptureObservationDto) => boolean,
): PickerChoice[] {
  return batch.observations
    .filter(include)
    .map((item) => ({ value: item.id, label: `${item.label} (#${item.pk})` }))
}

export function PartCreationFields({
  batch,
  control,
  register,
  disabled,
  observe,
  onDirty,
}: Props) {
  const parameters = useFieldArray({ control, name: 'parameters' })
  return (
    <Field>
      <MappingReader observe={observe} />
      <Label>
        New Part name
        <Input required maxLength={256} {...register('partName')} />
      </Label>
      <Controller
        name="categoryId"
        control={control}
        rules={{ required: 'Choose an observed category.' }}
        render={({ field, fieldState }) => (
          <ChoicePicker
            label="Existing category"
            clearable
            noun="categories"
            placeholder="Select an observed category"
            choices={observed(batch, (item) => item.model === 'category')}
            value={field.value}
            disabled={disabled}
            status={fieldState.error?.message}
            required
            invalid={Boolean(fieldState.error)}
            inputRef={field.ref}
            onChange={(value) => {
              field.onChange(value)
              onDirty()
            }}
          />
        )}
      />
      {parameters.fields.map((parameter, index) => (
        <Field key={parameter.id}>
          <Controller
            name={`parameters.${index}.templateId`}
            control={control}
            rules={{ required: 'Choose an observed template.' }}
            render={({ field, fieldState }) => (
              <ChoicePicker
                label="Parameter template"
                clearable
                noun="templates"
                placeholder="Select observed template"
                choices={observed(batch, (item) => item.model === 'parameter_template')}
                value={field.value}
                disabled={disabled}
                status={fieldState.error?.message}
                required
                invalid={Boolean(fieldState.error)}
                inputRef={field.ref}
                onChange={(value) => {
                  field.onChange(value)
                  onDirty()
                }}
              />
            )}
          />
          <Controller
            name={`parameters.${index}.mappingId`}
            control={control}
            rules={{ required: 'Choose an observed mapping.' }}
            render={({ field, fieldState }) => (
              <ChoicePicker
                label="Category parameter mapping"
                clearable
                noun="mappings"
                placeholder="Select observed mapping"
                choices={observed(batch, (item) => item.model === 'category_parameter')}
                value={field.value}
                disabled={disabled}
                status={fieldState.error?.message}
                required
                invalid={Boolean(fieldState.error)}
                inputRef={field.ref}
                onChange={(value) => {
                  field.onChange(value)
                  onDirty()
                }}
              />
            )}
          />
          <Label>
            Parameter value
            <Input required maxLength={256} {...register(`parameters.${index}.value`)} />
          </Label>
          <Button
            type="button"
            onClick={() => {
              parameters.remove(index)
              onDirty()
            }}
          >
            Remove parameter
          </Button>
        </Field>
      ))}
      <Button
        type="button"
        onClick={() => {
          parameters.append({ templateId: '', mappingId: '', value: '' })
          onDirty()
        }}
      >
        Add mapped parameter
      </Button>
      <Controller
        name="manufacturerId"
        control={control}
        render={({ field }) => (
          <ChoicePicker
            label="Existing manufacturer"
            noun="manufacturers"
            placeholder="Choose a manufacturer…"
            choices={[
              { value: '', label: 'No manufacturer relationship' },
              ...observed(
                batch,
                (item) => item.mapping?.kind === 'company' && item.mapping.manufacturer,
              ),
            ]}
            value={field.value}
            disabled={disabled}
            onChange={(value) => {
              field.onChange(value)
              onDirty()
            }}
          />
        )}
      />
      <Label>
        Manufacturer part number
        <Input maxLength={256} {...register('mpn')} />
      </Label>
      <Controller
        name="supplierId"
        control={control}
        render={({ field }) => (
          <ChoicePicker
            label="Existing supplier"
            noun="suppliers"
            placeholder="Choose a supplier…"
            choices={[
              { value: '', label: 'No supplier relationship' },
              ...observed(
                batch,
                (item) => item.mapping?.kind === 'company' && item.mapping.supplier,
              ),
            ]}
            value={field.value}
            disabled={disabled}
            onChange={(value) => {
              field.onChange(value)
              onDirty()
            }}
          />
        )}
      />
      <Label>
        Supplier SKU
        <Input maxLength={256} {...register('sku')} />
      </Label>
      <Label>
        New Part tags (comma separated)
        <Input maxLength={8192} {...register('tags')} />
      </Label>
      <Small>
        Names may create new tags when this shared Part is created. Reusing an existing Part never
        replaces its tags.
      </Small>
    </Field>
  )
}
