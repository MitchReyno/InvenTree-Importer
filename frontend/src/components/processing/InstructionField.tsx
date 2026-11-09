import { IntakeRequestError } from '@invimport/contracts/client'
import { useEffect, useState } from 'react'
import styled from 'styled-components'
import { color, space, typeVar } from '#/theme/generated/tokens'
import { Button, Small } from '#/components/ui'
import { TextArea } from '#/forms'
import { deliveryMessage, type InstructionDelivery } from '#/processing/instruction-delivery'
import { useReportDirty } from '#/navigation/useReportDirty'

type Props = {
  /** Undefined until the saved instructions are read; never assumed empty. */
  text: string | undefined
  revision: string
  /** Absent where this setup cannot save instructions. */
  instruct: ((text: string, revision: string, key: string) => Promise<unknown>) | undefined
  /** Whether the last saved instructions reached the agents; kept by the caller across reloads. */
  delivery?: InstructionDelivery
  /** Sends the saved instructions to the agents again; absent where this setup has none. */
  deliver?: () => void
  onDirtyChange: (dirty: boolean) => void
  /** The saved instructions could not be read, so they are not assumed empty. */
  unavailable?: boolean
  /** Why instructions cannot change here, such as an archived batch. */
  readOnlyReason?: string
  /** Another draft is saving and reloading Processing. */
  locked?: boolean
  /** Why saving is held back, such as another unsaved draft that a save would reload. */
  saveBlockedReason?: string
}

const MAX_CHARACTERS = 8192

/** Instructions for every agent working on the batch, saved explicitly from Processing. */
export function InstructionField({
  text,
  revision,
  instruct,
  delivery = { status: 'idle' },
  deliver,
  onDirtyChange,
  unavailable = false,
  readOnlyReason,
  saveBlockedReason,
  locked = false,
}: Props) {
  // Null while the field follows the saved instructions, which can arrive after mount.
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const loaded = text !== undefined
  const sent = deliveryMessage(delivery)

  // Once the saved instructions catch up with the draft, the field follows them again.
  if (loaded && draft !== null && draft === text) {
    setDraft(null)
  }
  const value = draft ?? text ?? ''
  const dirty = loaded && draft !== null && draft !== text
  // Saved instructions that catch up with the draft make it clean with no event here.
  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])
  useReportDirty(dirty, onDirtyChange)

  function discard() {
    setDraft(null)
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
      // The caller resolves after reloading, so the saved text is already the new value.
      await instruct(value, revision, crypto.randomUUID())
      setDraft(null)
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
        value={value}
        maxLength={MAX_CHARACTERS}
        disabled={!instruct || !loaded || saving || locked}
        onChange={(event) => {
          const next = event.target.value
          const differs = next !== text
          setDraft(differs ? next : null)
          onDirtyChange(differs)
        }}
      />
      {error && <Problem role="alert">{error}</Problem>}
      {delivery.status === 'failed' && (
        <Problem role="alert">
          Saved, but the agents could not be told yet.{' '}
          {deliver && (
            <Button size="sm" variant="link" onClick={deliver}>
              Send to the agents again
            </Button>
          )}
        </Problem>
      )}
      {sent && <Small role="status">{sent}</Small>}
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
      <Small>
        Saved for the batch and sent to its agents: running ones pick it up as they work, and
        finished ones are woken to apply it. Instructions do not approve inventory values.
      </Small>
    </Field>
  )
}

const Field = styled.div`
  display: grid;
  gap: ${space[4]};
  label {
    font-weight: ${typeVar.bodyStrong.weight};
  }
`

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[4]};
`

const Problem = styled.p`
  margin: 0;
  color: ${color.bad};
`
