import { useId, useState } from 'react'
import styled from 'styled-components'
import { Button, CheckboxLabel, Label, Small, TextArea } from './primitives'

type Props = {
  toggleLabel: string
  label: string
  /** Null means no current note; Hide is local and never changes the value. */
  value: string | null
  onChange: (value: string | null) => void
  disabled?: boolean
  maxLength?: number
}

/** Hide keeps the text for autosave; Remove retires the current note through a revision. */
export function OptionalNotesField({
  toggleLabel,
  label,
  value,
  onChange,
  disabled = false,
  maxLength = 8192,
}: Props) {
  const id = useId()
  const [open, setOpen] = useState(Boolean(value))
  const noun = label.toLowerCase()
  return (
    <Notes>
      <CheckboxLabel>
        <input
          type="checkbox"
          checked={open}
          disabled={disabled}
          aria-controls={open ? id : undefined}
          onChange={(event) => setOpen(event.target.checked)}
        />
        {toggleLabel}
      </CheckboxLabel>
      {open ? (
        <>
          <Label>
            {label}
            <TextArea
              id={id}
              value={value ?? ''}
              disabled={disabled}
              maxLength={maxLength}
              onChange={(event) => onChange(event.target.value)}
            />
          </Label>
          <Remove
            type="button"
            disabled={disabled}
            onClick={() => {
              onChange(null)
              setOpen(false)
            }}
          >
            Remove {noun}
          </Remove>
        </>
      ) : (
        value && (
          <Small>
            Hidden {noun} are kept ({value.length} characters).
          </Small>
        )
      )}
    </Notes>
  )
}

const Notes = styled.div`
  display: grid;
  gap: 8px;
  min-width: 0;
`
const Remove = styled(Button)`
  justify-self: start;
`
