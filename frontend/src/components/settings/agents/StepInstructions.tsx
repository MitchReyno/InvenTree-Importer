import { useId, useRef, useState, type ChangeEvent, type ClipboardEvent } from 'react'
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
  const [cut, setCut] = useState(false)
  const box = useRef<HTMLTextAreaElement | null>(null)
  // Set when the box closes under the operator's focus, so the step's button takes it back.
  const returnFocus = useRef(false)
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

  function openBox() {
    returnFocus.current = false
    flushSync(() => setOpen(true))
    box.current?.focus()
  }

  /** Typing stops at the limit: an input that would pass it is undone where it was made. */
  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const target = event.target
    setCut(false)
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
    setCut(true)
  }

  if (!shown) {
    return (
      <Button
        ref={(element) => {
          if (element && returnFocus.current) {
            returnFocus.current = false
            element.focus()
          }
        }}
        type="button"
        variant="ghost"
        size="sm"
        onClick={openBox}
      >
        <span aria-hidden="true">＋ </span>
        {label}
      </Button>
    )
  }

  const near = count >= NEAR_LIMIT

  return (
    <Box>
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
          <Cut role="status">{cut ? CUT_MESSAGE : ''}</Cut>
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
            returnFocus.current = true
            setOpen(false)
          }
          text.save()
        }}
        onRetry={text.retry}
        onReload={text.reload}
        onDiscard={() => {
          returnFocus.current = true
          flushSync(() => {
            setOpen(false)
            setCut(false)
            text.discard()
          })
          // The box stays for saved instructions; focus goes back into it.
          if (box.current?.isConnected) {
            returnFocus.current = false
            box.current.focus()
          }
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
