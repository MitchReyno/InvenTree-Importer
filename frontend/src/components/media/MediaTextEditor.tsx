import { useRef } from 'react'
import { useForm } from 'react-hook-form'
import { Small, Banner, Button } from '#/components/ui'
import { Fieldset, Form, Input, Label, TextArea } from '#/forms'

type Props = {
  label: string
  action: string
  text: string
  revision: string
  maximum: number
  multiline?: boolean
  trim?: boolean
  disabled: boolean
  pending: boolean
  onSave: (text: string, revision: string) => Promise<boolean>
  onCancel: () => void
  onDirtyChange: (dirty: boolean) => void
}

export function MediaTextEditor({
  label,
  action,
  text,
  revision,
  maximum,
  multiline,
  trim,
  disabled,
  pending,
  onSave,
  onCancel,
  onDirtyChange,
}: Props) {
  const loadedRevision = useRef(revision)
  const { register, handleSubmit, formState } = useForm({ defaultValues: { text } })
  const field = register('text', {
    validate: (value) => {
      if (trim && !value.trim()) {
        return 'Enter a nonempty name.'
      }
      return [...value].length <= maximum || `At most ${maximum} characters.`
    },
  })

  async function save(values: { text: string }) {
    if (disabled || pending) {
      return
    }
    const confirmed = await onSave(trim ? values.text.trim() : values.text, loadedRevision.current)
    if (confirmed) {
      onDirtyChange(false)
      onCancel()
    }
  }

  return (
    <Form
      aria-label={`${label} editor`}
      onChange={() => onDirtyChange(true)}
      onSubmit={handleSubmit(save)}
    >
      <Fieldset disabled={disabled || pending || formState.isSubmitting}>
        <Label>
          {label}
          {multiline ? (
            <TextArea {...field} maxLength={maximum * 2} />
          ) : (
            <Input {...field} required maxLength={maximum * 2} />
          )}
        </Label>
        {formState.errors.text && (
          <div role="alert">
            <Banner tone="bad">{formState.errors.text.message}</Banner>
          </div>
        )}
        <Button type="submit" disabled={!formState.isDirty}>
          {action}
        </Button>
      </Fieldset>
      <Button
        type="button"
        disabled={pending || formState.isSubmitting}
        onClick={() => {
          onDirtyChange(false)
          onCancel()
        }}
      >
        Discard {label.toLowerCase()} edits
      </Button>
      {pending && (
        <Small>Resolve the retained request below before changing or discarding this draft.</Small>
      )}
    </Form>
  )
}
