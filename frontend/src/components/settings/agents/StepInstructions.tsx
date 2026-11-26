import { useEffect, useId, useRef, useState, type ChangeEvent, type ClipboardEvent } from 'react'
import { flushSync } from 'react-dom'
import styled from 'styled-components'
import {
  AGENT_INSTRUCTION_STAGES,
  STEP_INSTRUCTIONS_MAX_CHARACTERS,
  type AgentInstructionStage,
  type AgentSettingsDto,
} from '@invimport/contracts'
import { Button, Small } from '#/components/ui'
import { TextArea } from '#/forms'
import { color, space, type, typeVar } from '#/theme/generated/tokens'
import { SaveBar } from './SaveBar'
import { storable, STAGE_LABEL } from './provider-form'
import type { FieldKey, SettingsFields } from './settings-fields'
import { useSubsectionForm, type SubsectionFormProps } from './useSubsectionForm'

/** The count turns amber from here, so the limit is in view before typing stops. */
const NEAR_LIMIT = 900
const CUT_MESSAGE = `${STEP_INSTRUCTIONS_MAX_CHARACTERS.toLocaleString()} characters is the most a step can hold. The pasted text was cut at ${STEP_INSTRUCTIONS_MAX_CHARACTERS.toLocaleString()}.`

type Values = { text: string }

/** Each step's form wiring, at module scope so the subsection form sees stable functions. */
const FORMS = Object.fromEntries(
  AGENT_INSTRUCTION_STAGES.map((stage) => [
    stage,
    {
      keys: [`stage_instructions.${stage}`] as readonly FieldKey[],
      read: (settings: AgentSettingsDto): Values => ({
        text: settings.stage_instructions[stage] ?? '',
      }),
      // An empty box saves as no instructions.
      write: ({ text }: Values): Partial<SettingsFields> => ({
        stage_instructions: text === '' ? {} : { [stage]: text },
      }),
    },
  ]),
) as Record<
  AgentInstructionStage,
  {
    keys: readonly FieldKey[]
    read: (settings: AgentSettingsDto) => Values
    write: (values: Values) => Partial<SettingsFields>
  }
>

function characters(text: string) {
  return [...text].length
}

/** The text with `pasted` put in place of the selection, cut so the whole fits the limit. */
function pastedWithin(text: string, start: number, end: number, pasted: string) {
  const before = text.slice(0, start)
  const after = text.slice(end)
  const room = STEP_INSTRUCTIONS_MAX_CHARACTERS - characters(before) - characters(after)
  const kept = [...pasted].slice(0, Math.max(room, 0)).join('')
  return { text: before + kept + after, caret: before.length + kept.length, cut: kept !== pasted }
}

/**
 * One step's own instructions, under its model and effort, saved with Save and Discard. A step
 * without any shows a quiet button that opens an empty box. The count turns amber from 900;
 * typing stops at 1,000, and a paste past it is cut there with a message.
 */
export function StepInstructions({
  stage,
  ...props
}: SubsectionFormProps & { stage: AgentInstructionStage }) {
  const { keys, read, write } = FORMS[stage]
  const { form, markEdited, text } = useSubsectionForm({
    ...props,
    id: `step-instructions-${stage}`,
    read,
    write,
    keys,
  })
  const [open, setOpen] = useState(false)
  // Which of two live regions holds the cut message, so a cut repeated in a row is a new
  // announcement rather than the same text again.
  const [cutIn, setCutIn] = useState<0 | 1 | null>(null)
  const box = useRef<HTMLTextAreaElement | null>(null)
  const button = useRef<HTMLButtonElement | null>(null)
  const editor = useRef<HTMLDivElement | null>(null)
  // Set by Save until the save is confirmed or the edit dropped.
  const [saving, setSaving] = useState(false)
  // Whether the operator is in the editor while it saves: focusing or pressing anything changes it,
  // so when the save removes the focused Save button, focus follows only an operator still here.
  const inEditor = useRef(false)
  const id = useId()
  const label = `Instructions for ${STAGE_LABEL[stage]}`
  const value = form.watch('text')
  const count = characters(value)
  const saved = props.loaded.stage_instructions[stage] !== undefined
  // A box stays while it holds an edit or a save's unsettled outcome; once instructions are
  // saved as removed, the step shows its button again.
  const unsettled = text.state !== 'idle' && text.state !== 'saved'
  const shown = open || saved || text.dirty || unsettled
  const field = form.register('text', {
    validate: (next) => characters(next) <= STEP_INSTRUCTIONS_MAX_CHARACTERS && storable(next),
    onChange: () => markEdited('text'),
  })

  // Follows the document while a save is pending, so the operator's place is known when it ends.
  useEffect(() => {
    if (!saving) {
      return
    }

    const followed = (event: Event) => {
      inEditor.current = event.target instanceof Node && !!editor.current?.contains(event.target)
    }

    document.addEventListener('pointerdown', followed, true)
    document.addEventListener('focusin', followed, true)
    return () => {
      document.removeEventListener('pointerdown', followed, true)
      document.removeEventListener('focusin', followed, true)
    }
  }, [saving])

  // Syncs DOM focus with a confirmed save, once: Save's button goes, and an operator still in the
  // editor gets focus back in the box, or on the step's button when the save removed the box.
  useEffect(() => {
    if (!saving || text.dirty) {
      return
    }
    // A cleared box waits for the read that removes it, so focus lands on the step's button.
    if (shown && form.getValues('text') === '') {
      return
    }
    setSaving(false)
    if (inEditor.current) {
      ;(box.current ?? button.current)?.focus()
    }
  }, [saving, text.dirty, shown, form])

  function openBox() {
    flushSync(() => setOpen(true))
    box.current?.focus()
  }

  /** Typing stops at the limit: an input that would pass it is undone where it was made. */
  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const target = event.target
    setCutIn(null)
    if (characters(target.value) > STEP_INSTRUCTIONS_MAX_CHARACTERS) {
      const added = target.value.length - value.length
      const caret = Math.max((target.selectionStart ?? target.value.length) - added, 0)
      target.value = value
      target.setSelectionRange(caret, caret)
      return
    }
    void field.onChange(event)
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const target = event.currentTarget
    // A save in flight holds the box, for a paste as for typing.
    if (target.readOnly) {
      return
    }
    // A textarea holds each line break as one character, however the clipboard wrote it.
    const pasted = event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n')
    const next = pastedWithin(target.value, target.selectionStart, target.selectionEnd, pasted)
    if (!next.cut) {
      return
    }
    event.preventDefault()
    form.setValue('text', next.text)
    target.setSelectionRange(next.caret, next.caret)
    markEdited('text')
    setCutIn((region) => (region === 0 ? 1 : 0))
  }

  if (!shown) {
    return (
      <Button ref={button} type="button" variant="ghost" size="sm" onClick={openBox}>
        <span aria-hidden="true">＋ </span>
        {label}
      </Button>
    )
  }

  const near = count >= NEAR_LIMIT

  return (
    <Box ref={editor}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Text
        id={id}
        rows={3}
        readOnly={text.busy}
        aria-describedby={`${id}-help ${id}-count`}
        $near={near}
        {...field}
        ref={(element) => {
          field.ref(element)
          box.current = element
        }}
        onChange={handleChange}
        onPaste={handlePaste}
      />
      <Foot>
        <span>
          <Small id={`${id}-help`}>
            Read by new {STAGE_LABEL[stage]} sessions, after the app’s own rules.
          </Small>{' '}
          <Cut role="status">{cutIn === 0 ? CUT_MESSAGE : ''}</Cut>
          <Cut role="status">{cutIn === 1 ? CUT_MESSAGE : ''}</Cut>
        </span>
        <Count id={`${id}-count`} $near={near}>
          {count.toLocaleString()} / {STEP_INSTRUCTIONS_MAX_CHARACTERS.toLocaleString()}
        </Count>
      </Foot>
      <SaveBar
        state={text.state}
        busy={text.busy}
        waiting={text.waiting}
        savedMessage={`Saved. New ${STAGE_LABEL[stage]} sessions read it; queued and running ones keep theirs.`}
        onSave={() => {
          // Saving an empty box removes the instructions, and the step shows its button again.
          if (form.getValues('text') === '') {
            setOpen(false)
          }
          inEditor.current = true
          setSaving(true)
          text.save()
        }}
        onRetry={text.retry}
        onReload={text.reload}
        onDiscard={() => {
          setSaving(false)
          flushSync(() => {
            setOpen(false)
            setCutIn(null)
            text.discard()
          })
          // Into the box when it stays for saved instructions, else to the step's button.
          ;(box.current ?? button.current)?.focus()
        }}
        dirty={text.dirty}
      />
    </Box>
  )
}

const Box = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[3]};
  width: 100%;
  min-width: 0;
`

const FieldLabel = styled.label`
  ${type.small}
  font-weight: ${typeVar.bodyStrong.weight};
`

const Text = styled(TextArea)<{ $near: boolean }>`
  border-color: ${({ $near }) => ($near ? color.warn : undefined)};
`

const Foot = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: ${space[2]} ${space[4]};
  small {
    color: ${color.muted};
  }
`

const Count = styled.span<{ $near: boolean }>`
  ${type.mono}
  color: ${({ $near }) => ($near ? color.warn : color.muted)};
`

const Cut = styled.small`
  ${type.small}
  color: ${color.warn};
`
