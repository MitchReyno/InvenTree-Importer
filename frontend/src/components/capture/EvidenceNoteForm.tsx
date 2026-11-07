import { useForm } from 'react-hook-form'
import styled from 'styled-components'
import { color, space } from '../../theme/generated/tokens'
import type { CaptureWorkspaceProps } from '../../capture/types'
import { Fieldset, Form, Label, Small, TextArea } from '../ui/primitives'
import { Button } from '../ui/Button'

type Props = {
  disabled: boolean
  edit: CaptureWorkspaceProps['edit']
  onDirtyChange: (dirty: boolean) => void
  onClose: () => void
}

const MAX_NOTE_CHARACTERS = 8192

/** Appends a batch evidence note. Notes are retained history, so this saves explicitly. */
export function EvidenceNoteForm({ disabled, edit, onDirtyChange, onClose }: Props) {
  const {
    register,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm({ defaultValues: { text: '' } })

  async function save({ text }: { text: string }) {
    if ((await edit({ kind: 'note', subject_id: null, text })) === false) {
      return
    }
    onDirtyChange(false)
    onClose()
  }

  function discard() {
    onDirtyChange(false)
    onClose()
  }

  return (
    <NoteForm
      onChange={() => onDirtyChange(true)}
      onSubmit={handleSubmit(save)}
      aria-label="Evidence note"
    >
      <Fieldset disabled={disabled || isSubmitting}>
        <Label>
          Evidence note
          <TextArea
            autoFocus
            maxLength={MAX_NOTE_CHARACTERS}
            {...register('text', {
              validate: (value) => value.trim().length > 0 || 'Enter the note text.',
            })}
          />
        </Label>
        {errors.text && <Small role="alert">{errors.text.message}</Small>}
        <Small>Appended to this batch's retained evidence. It is not an inventory fact.</Small>
        <Actions>
          <Button type="submit">Save note</Button>
          <Button type="button" onClick={discard}>
            Discard note
          </Button>
        </Actions>
      </Fieldset>
    </NoteForm>
  )
}

const NoteForm = styled(Form)`
  margin: ${space[6]} 0;
  padding: ${space[6]};
  border: 1px solid ${color.line};
  border-radius: 6px;
  background: ${color.surface2};
`
const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[4]};
`
