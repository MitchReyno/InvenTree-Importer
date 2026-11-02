import type { Control, UseFormRegister } from 'react-hook-form'
import { useFieldArray } from 'react-hook-form'
import type { CaptureEditorValues } from '../../capture/editor-model'
import type { CaptureWorkspaceProps, Snapshot } from '../../capture/types'
import { Button, Input, Label, Select, Field, Small } from '../ui/primitives'
import { MappingReader } from './MappingReader'

interface Props {
  batch: Snapshot
  control: Control<CaptureEditorValues>
  register: UseFormRegister<CaptureEditorValues>
  observe: CaptureWorkspaceProps['observe']
  onDirty: () => void
}

export function PartCreationFields({ batch, control, register, observe, onDirty }: Props) {
  const parameters = useFieldArray({ control, name: 'parameters' })
  return (
    <Field>
      <MappingReader observe={observe} />
      <Label>
        New Part name
        <Input required maxLength={256} {...register('partName')} />
      </Label>
      <Label>
        Existing category
        <Select required {...register('categoryId')}>
          <option value="">Select an observed category</option>
          {batch.observations
            .filter((item) => item.model === 'category')
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.label} (#{item.pk})
              </option>
            ))}
        </Select>
      </Label>
      {parameters.fields.map((parameter, index) => (
        <Field key={parameter.id}>
          <Label>
            Parameter template
            <Select required {...register(`parameters.${index}.templateId`)}>
              <option value="">Select observed template</option>
              {batch.observations
                .filter((item) => item.model === 'parameter_template')
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label} (#{item.pk})
                  </option>
                ))}
            </Select>
          </Label>
          <Label>
            Category parameter mapping
            <Select required {...register(`parameters.${index}.mappingId`)}>
              <option value="">Select observed mapping</option>
              {batch.observations
                .filter((item) => item.model === 'category_parameter')
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label} (#{item.pk})
                  </option>
                ))}
            </Select>
          </Label>
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
      <Label>
        Existing manufacturer
        <Select {...register('manufacturerId')}>
          <option value="">No manufacturer relationship</option>
          {batch.observations
            .filter((item) => item.mapping?.kind === 'company' && item.mapping.manufacturer)
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.label} (#{item.pk})
              </option>
            ))}
        </Select>
      </Label>
      <Label>
        Manufacturer part number
        <Input maxLength={256} {...register('mpn')} />
      </Label>
      <Label>
        Existing supplier
        <Select {...register('supplierId')}>
          <option value="">No supplier relationship</option>
          {batch.observations
            .filter((item) => item.mapping?.kind === 'company' && item.mapping.supplier)
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.label} (#{item.pk})
              </option>
            ))}
        </Select>
      </Label>
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
