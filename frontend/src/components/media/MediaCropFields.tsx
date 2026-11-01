import { Controller, type Control, type UseFormSetValue } from 'react-hook-form'
import styled from 'styled-components'
import { cropAspect, type CropAspect, type CropForm } from '../../media/crop-model'

interface Props {
  control: Control<CropForm>
  setValue: UseFormSetValue<CropForm>
  width: number
  aspect: CropAspect
  disabled: boolean
}

const ratios = ['1:1', '4:3', '3:2', '16:9'] as const
const fieldNames = ['centerX', 'centerY', 'width', 'height', 'degrees'] as const
const labels = {
  centerX: 'Center X',
  centerY: 'Center Y',
  width: 'Width',
  height: 'Height',
  degrees: 'Clockwise angle',
}

export function MediaCropFields({ control, setValue, width, aspect, disabled }: Props) {
  function updateLockedDimension(name: (typeof fieldNames)[number], value: number) {
    const ratio = cropAspect(aspect)
    if (ratio && name === 'width') {
      setValue('frame.height', (value * ratio.height) / ratio.width)
    } else if (ratio && name === 'height') {
      setValue('frame.width', (value * ratio.width) / ratio.height)
    }
  }

  return (
    <fieldset disabled={disabled}>
      <Fields>
        {fieldNames.map((name) => (
          <Controller
            key={name}
            name={`frame.${name}`}
            control={control}
            render={({ field }) => (
              <label>
                {labels[name]}
                <input
                  type="number"
                  step="0.001"
                  value={Number.isFinite(field.value) ? field.value : ''}
                  onChange={(event) => {
                    const value = event.target.valueAsNumber
                    field.onChange(value)
                    updateLockedDimension(name, value)
                  }}
                />
              </label>
            )}
          />
        ))}
        <Controller
          name="aspect"
          control={control}
          render={({ field }) => (
            <label>
              Aspect ratio
              <select
                value={field.value}
                onChange={(event) => {
                  const value = ratios.find((ratio) => ratio === event.target.value) ?? 'free'
                  field.onChange(value)
                  const ratio = cropAspect(value)
                  if (ratio) {
                    setValue('frame.height', (width * ratio.height) / ratio.width)
                  }
                }}
              >
                <option value="free">Unlocked</option>
                {ratios.map((ratio) => (
                  <option value={ratio} key={ratio}>
                    Locked {ratio}
                  </option>
                ))}
              </select>
            </label>
          )}
        />
      </Fields>
    </fieldset>
  )
}

const Fields = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 12px;
  label {
    display: grid;
    gap: 6px;
  }
  input,
  select {
    min-width: 0;
    width: 100%;
    box-sizing: border-box;
    padding: 8px;
  }
`
