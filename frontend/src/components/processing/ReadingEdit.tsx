import { useEffect, useState } from 'react'
import styled from 'styled-components'
import type { CaptureSnapshotDto } from '@invimport/contracts'
import { space } from '#/theme/generated/tokens'
import { Button, HelpButton, VisuallyHidden } from '#/components/ui'
import { Label, TextArea } from '#/forms'
import type { CaptureEdit } from '#/capture/types'
import { useReportDirty } from '#/navigation/useReportDirty'

type Observation = NonNullable<CaptureSnapshotDto['evidence_observations']>[number]

/** The form a reading is saved in: trimmed, without empty markings. */
function savedForm(markings: string[], text: string) {
  return { markings: markings.map((marking) => marking.trim()).filter(Boolean), text: text.trim() }
}

/** A reading's markings and text, one field per marking. */
export function ReadingEdit({
  observation,
  save,
  locked,
  onDirty,
}: {
  observation: Observation
  save: CaptureEdit
  /** Another correction is unsaved, so this one waits. */
  locked: boolean
  onDirty: (dirty: boolean) => void
}) {
  const { readings } = observation
  const name = (readings.markings.join(' · ') || readings.text || 'this region').replace(
    /\s+/g,
    ' ',
  )
  // One field per marking keeps each marking whole, whatever characters it holds.
  const [markings, setMarkings] = useState<string[]>(readings.markings)
  const [text, setText] = useState(readings.text ?? '')
  const [saving, setSaving] = useState(false)

  // A confirmed save is the baseline until new readings arrive; the draft then compares with them.
  const over = JSON.stringify(readings)
  const [confirmed, setConfirmed] = useState<{
    markings: string[]
    text: string
    over: string
  } | null>(null)
  if (confirmed && confirmed.over !== over) {
    setConfirmed(null)
  }
  const baseline =
    confirmed && confirmed.over === over
      ? confirmed
      : { markings: readings.markings, text: readings.text ?? '' }

  // Both sides are compared in saved form: spacing or an empty marking is not an unsaved change,
  // and readings from an agent may carry spacing a save would trim.
  const baselineForm = savedForm(baseline.markings, baseline.text)

  const differs = (nextMarkings: string[], nextText: string) => {
    const next = savedForm(nextMarkings, nextText)
    return (
      next.text !== baselineForm.text ||
      next.markings.length !== baselineForm.markings.length ||
      next.markings.some((marking, index) => marking !== baselineForm.markings[index])
    )
  }

  const dirty = differs(markings, text)
  useReportDirty(dirty, onDirty)
  // Readings passed in by the parent can make the draft clean or dirty with no event here.
  // Processing currently remounts on each revision, so this covers the component's contract.
  useEffect(() => {
    onDirty(dirty)
  }, [dirty, onDirty])

  function changeMarkings(next: string[]) {
    setMarkings(next)
    onDirty(differs(next, text))
  }

  function changeText(next: string) {
    setText(next)
    onDirty(differs(markings, next))
  }

  const busy = saving || locked
  return (
    <ReadingForm
      aria-label={`Readings for ${name}`}
      onSubmit={(event) => {
        event.preventDefault()
        setSaving(true)
        const { markings: saved, text: kept } = savedForm(markings, text)
        void save({
          kind: 'observation',
          observation_id: observation.id,
          evidence_version_id: observation.evidence_version_id,
          page: observation.page,
          region: observation.region,
          readings: {
            markings: saved,
            ...(kept ? { text: kept } : {}),
          },
        })
          .then((result) => {
            // The draft takes the saved form, so the reloaded readings match it and the guard stays
            // released.
            if (result !== false) {
              setMarkings(saved)
              setText(kept)
              setConfirmed({ markings: saved, text: kept, over })
              onDirty(false)
            }
          })
          .finally(() => setSaving(false))
      }}
    >
      {markings.map((marking, index) => (
        <Label key={index}>
          <VisuallyHidden>
            Marking {index + 1} for {name}
          </VisuallyHidden>
          <MarkingField
            rows={Math.max(1, marking.split('\n').length)}
            value={marking}
            disabled={busy}
            onChange={(event) =>
              changeMarkings(
                markings.map((value, at) => (at === index ? event.target.value : value)),
              )
            }
          />
        </Label>
      ))}
      {markings.length < 32 && (
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          aria-label={`Add a marking for ${name}`}
          onClick={() => changeMarkings([...markings, ''])}
        >
          Add a marking
        </Button>
      )}
      <Label>
        <VisuallyHidden>Text for {name}</VisuallyHidden>
        <TextArea
          rows={2}
          placeholder="Other text read from the photo"
          value={text}
          disabled={busy}
          onChange={(event) => changeText(event.target.value)}
        />
      </Label>
      <span>
        <Button
          size="sm"
          type="submit"
          disabled={busy || !dirty}
          aria-label={`Save readings for ${name}`}
        >
          Save
        </Button>{' '}
        {dirty && (
          <Button
            size="sm"
            variant="ghost"
            disabled={saving}
            onClick={() => {
              setMarkings(baseline.markings)
              setText(baseline.text)
              onDirty(false)
            }}
          >
            Discard
          </Button>
        )}{' '}
        <HelpButton
          label={`About markings for ${name}`}
          explanation="To remove a marking, clear its text and save."
        />
      </span>
    </ReadingForm>
  )
}

const ReadingForm = styled.form`
  display: grid;
  justify-items: start;
  gap: ${space[3]};
  max-width: 28rem;
  label,
  textarea {
    width: 100%;
  }
`
/** One line per marking line, rather than the default note height. */
const MarkingField = styled(TextArea)`
  min-height: 0;
`
