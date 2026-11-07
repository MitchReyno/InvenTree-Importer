import {
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import styled from 'styled-components'
import { color, space, typeVar } from '../../theme/generated/tokens'
import { Button } from './Button'
import { CheckboxLabel, Input, Select, Small, TextArea } from './primitives'

type FieldProps = {
  label: ReactNode
  /** One plain line under the control. */
  help?: ReactNode
  /** Replaces the help, says how to fix the value and marks the control invalid. */
  error?: string
}

type TextFieldProps = FieldProps &
  (
    | ({ as?: 'input'; ref?: Ref<HTMLInputElement> } & InputHTMLAttributes<HTMLInputElement>)
    | ({ as: 'select'; ref?: Ref<HTMLSelectElement> } & SelectHTMLAttributes<HTMLSelectElement>)
    | ({
        as: 'textarea'
        ref?: Ref<HTMLTextAreaElement>
      } & TextareaHTMLAttributes<HTMLTextAreaElement>)
  )

/** A text input, select or textarea with its label above and help or an error below. */
export function TextField({ label, help, error, ...control }: TextFieldProps) {
  const generated = useId()
  const id = control.id ?? generated
  const noteId = `${id}-note`
  const note = error ?? help
  // A caller's own invalid state and descriptions are kept; the note is added to them.
  const describedBy = [control['aria-describedby'], note ? noteId : undefined]
    .filter(Boolean)
    .join(' ')
  const shared = {
    id,
    'aria-invalid': error ? true : control['aria-invalid'],
    'aria-describedby': describedBy || undefined,
  } as const
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {control.as === 'select' ? (
        <Select {...control} {...shared} as={undefined} />
      ) : control.as === 'textarea' ? (
        <TextArea {...control} {...shared} as={undefined} />
      ) : (
        <Input {...control} {...shared} as={undefined} />
      )}
      {note && (
        <Note id={noteId} $error={Boolean(error)}>
          {note}
        </Note>
      )}
    </Field>
  )
}

type NotesFieldProps = {
  toggleLabel: string
  label: string
  /** Null means no current note; Hide is local and never changes the value. */
  value: string | null
  onChange: (value: string | null) => void
  disabled?: boolean
  maxLength?: number
}

/** Optional notes: a checkbox reveals the textarea. Hide keeps the text; Remove clears it. */
export function NotesField({
  toggleLabel,
  label,
  value,
  onChange,
  disabled = false,
  maxLength = 8192,
}: NotesFieldProps) {
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
          <TextField
            as="textarea"
            id={id}
            label={label}
            value={value ?? ''}
            disabled={disabled}
            maxLength={maxLength}
            onChange={(event) => onChange(event.target.value)}
          />
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

const Field = styled.div`
  display: grid;
  gap: ${space[2]};
  min-width: 0;
`

const FieldLabel = styled.label`
  font-size: ${typeVar.small.size};
  font-weight: ${typeVar.bodyStrong.weight};
`

const Note = styled.span<{ $error: boolean }>`
  font-size: ${typeVar.small.size};
  line-height: ${typeVar.small.lineHeight};
  color: ${({ $error }) => ($error ? color.bad : color.muted)};
`

const Notes = styled.div`
  display: grid;
  gap: ${space[4]};
  min-width: 0;
`

const Remove = styled(Button)`
  justify-self: start;
`
