import { IntakeRequestError } from '@invimport/contracts/client'
import { useEffect, useState } from 'react'
import styled from 'styled-components'
import { color, space } from '../../theme/generated/tokens'
import { Button } from '../ui/Button'
import { Small, TextArea } from '../ui/primitives'

type Props = {
  /** Undefined until the saved instructions are read; never assumed empty. */
  text: string | undefined
  revision: string
  /** Absent where this setup cannot save instructions. */
  instruct: ((text: string, revision: string, key: string) => Promise<unknown>) | undefined
  onDirtyChange: (dirty: boolean) => void
  /** The saved instructions could not be read, so they are not assumed empty. */
  unavailable?: boolean
  /** Why instructions cannot change here, such as an archived batch. */
  readOnlyReason?: string
  /** Why saving is held back, such as another unsaved draft that a save would reload. */
  saveBlockedReason?: string
}

const MAX_CHARACTERS = 8192

/** Instructions for every agent working on the batch, saved explicitly from Processing. */
export function InstructionField({
  text,
  revision,
  instruct,
  onDirtyChange,
  unavailable = false,
  readOnlyReason,
  saveBlockedReason,
}: Props) {
  const [draft, setDraft] = useState(text ?? '')
  const [edited, setEdited] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const loaded = text !== undefined
  const dirty = loaded && edited && draft !== text

  // Saved instructions can arrive after mount; take them unless the operator is editing.
  useEffect(() => {
    if (text !== undefined && !edited) {
      setDraft(text)
    }
  }, [text, edited])

  function discard() {
    setDraft(text ?? '')
    setEdited(false)
    setError('')
    onDirtyChange(false)
  }

  async function save() {
    if (!instruct) {
      return
    }
    setSaving(true)
    setError('')
    try {
      await instruct(draft, revision, crypto.randomUUID())
      setEdited(false)
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
        disabled={!instruct || !loaded || saving}
        onChange={(event) => {
          setDraft(event.target.value)
          setEdited(true)
          onDirtyChange(event.target.value !== text)
        }}
      />
      {error && <Problem role="alert">{error}</Problem>}
      {!loaded && unavailable && (
        <Problem role="alert">
          The saved instructions are unavailable, so they cannot be changed here right now.
        </Problem>
      )}
      {!loaded && !unavailable && <Small role="status">Reading the saved instructions…</Small>}
      {dirty && saveBlockedReason && <Small>{saveBlockedReason}</Small>}
      {instruct ? (
        <Actions>
          <Button
            size="sm"
            disabled={!dirty || Boolean(saveBlockedReason)}
            busy={saving}
            onClick={() => void save()}
          >
            Save instructions
          </Button>
          <Button size="sm" variant="ghost" disabled={!dirty || saving} onClick={discard}>
            Discard changes
          </Button>
        </Actions>
      ) : (
        <Small>{readOnlyReason ?? 'Instructions are not available in this setup.'}</Small>
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
`

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[2]};
`

const Problem = styled.p`
  margin: 0;
  color: ${color.bad};
`
