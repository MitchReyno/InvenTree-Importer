import { IntakeRequestError } from '@invimport/contracts/client'
import { useState } from 'react'
import styled from 'styled-components'
import { color, space } from '../../theme/generated/tokens'
import { Button } from '../ui/Button'
import { Small, TextArea } from '../ui/primitives'

type Props = {
  text: string
  revision: string
  /** Absent where this setup cannot save instructions. */
  instruct: ((text: string, revision: string, key: string) => Promise<unknown>) | undefined
  onDirtyChange: (dirty: boolean) => void
}

const MAX_CHARACTERS = 8192

/** Instructions for every agent working on the batch, saved explicitly from Processing. */
export function InstructionField({ text, revision, instruct, onDirtyChange }: Props) {
  const [draft, setDraft] = useState(text)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const dirty = draft !== text

  async function save() {
    if (!instruct) {
      return
    }
    setSaving(true)
    setError('')
    try {
      await instruct(draft, revision, crypto.randomUUID())
      onDirtyChange(false)
    } catch (caught) {
      setError(
        caught instanceof IntakeRequestError && caught.code === 'revision_conflict'
          ? 'The batch changed since these instructions were loaded. Your draft is kept; reload to see the saved version.'
          : 'The instructions could not be saved. Your draft is kept.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Field>
      <label htmlFor="batch-instructions">Instructions for the whole batch</label>
      <TextArea
        id="batch-instructions"
        value={draft}
        maxLength={MAX_CHARACTERS}
        disabled={!instruct || saving}
        onChange={(event) => {
          setDraft(event.target.value)
          onDirtyChange(event.target.value !== text)
        }}
      />
      {error && <Problem role="alert">{error}</Problem>}
      {instruct ? (
        <Button size="sm" disabled={!dirty} busy={saving} onClick={() => void save()}>
          Save instructions
        </Button>
      ) : (
        <Small>Instructions are not available in this setup.</Small>
      )}
      <Small>Every agent on this batch reads them. They do not approve inventory values.</Small>
    </Field>
  )
}

const Field = styled.div`
  display: grid;
  gap: ${space[2]};
  label {
    font-weight: 600;
  }
  > button {
    justify-self: start;
  }
`

const Problem = styled.p`
  margin: 0;
  color: ${color.bad};
`
