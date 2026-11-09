import { useEffect, useRef, useState, type ReactNode } from 'react'
import styled from 'styled-components'
import type { ProcessingAnswerDto, ProcessingQuestionDto } from '@invimport/contracts'
import { DisabledFeature } from '#/components/ui'
import { color, radius, space, typeVar } from '#/theme/generated/tokens'
import { QuestionAnswer } from './QuestionAnswer'

const OPTIONS_NOT_CARRIED =
  'Questions don’t carry the session’s answer options yet, so answer in words below.'

/** Placeholders for the options a session will offer; true for any question. */
const OPTIONS = [
  { id: 'first', title: 'First option from the session', detail: 'Not carried yet' },
  { id: 'second', title: 'Second option from the session', detail: 'Not carried yet' },
]

/** A question as its form pinned it, with the capture revision the answer is checked against. */
type Pin = { question: ProcessingQuestionDto; revision: string }

type Props = {
  /** The session's open questions, from the latest Processing read. */
  questions: ProcessingQuestionDto[]
  /** Any question in the latest read, whatever its state; undefined once it is gone. */
  lookup: (questionId: string) => ProcessingQuestionDto | undefined
  captureRevision: string
  /** This mount has read Processing afresh, so a question can be pinned to a form. */
  fresh: boolean
  /** Answering is unavailable for every form, such as while commands wait for a read. */
  disabled: boolean
  readOnly: boolean
  /** An answer is saving, which reloads Processing and changes the capture revision. */
  saving: boolean
  isDirty: (questionId: string) => boolean
  /** Another answer form, in the drawer or on the page, has an unsaved draft. */
  otherAnswerDirty: (questionId: string) => boolean
  answer: (questionId: string, input: ProcessingAnswerDto, key: string) => Promise<void>
  reportFor: (questionId: string) => (dirty: boolean) => void
  /** Where a question without a form yet goes, such as its link to the step page. */
  fallback: (question: ProcessingQuestionDto) => ReactNode
  /** An answer saved just before Processing remounted: focus the next question once it shows. */
  focusNext?: boolean
  /** The latest Processing read failed or is paused. */
  readFailed?: boolean
}

/** The pins after this read: open questions get forms, clean forms follow it or leave. */
function nextPins(
  pins: Readonly<Record<string, Pin>>,
  { questions, captureRevision, fresh, saving, isDirty }: Props,
) {
  const next: Record<string, Pin> = { ...pins }
  let changed = false
  const open = new Set(questions.map((question) => question.id))
  for (const question of questions) {
    const pin = pins[question.id]
    const behind = pin !== undefined && pin.revision !== captureRevision
    const follows = behind && !isDirty(question.id) && !saving
    if (fresh && (pin === undefined || follows)) {
      next[question.id] = { question, revision: captureRevision }
      changed = true
    }
  }
  // A question no longer open keeps its form only while the form holds a draft.
  for (const id of Object.keys(pins)) {
    if (!open.has(id) && !isDirty(id)) {
      delete next[id]
      changed = true
    }
  }
  return changed ? next : pins
}

/**
 * A session drawer's questions, answered in place. Each form pins its question and capture
 * revision from a fresh read and keeps them while its draft is unsaved, even after the question
 * is answered elsewhere, superseded or gone, so the draft stays with its superseded notice; a
 * clean form follows the revision another answer moved. A failed read never unmounts a form.
 */
export function DrawerAnswers(props: Props) {
  const {
    questions,
    lookup,
    captureRevision,
    disabled,
    readOnly,
    saving,
    otherAnswerDirty,
    answer,
    reportFor,
    fallback,
    focusNext = false,
    readFailed = false,
  } = props
  const [pins, setPins] = useState<Readonly<Record<string, Pin>>>({})
  const container = useRef<HTMLDivElement>(null)
  const answered = useRef(focusNext)
  const current = nextPins(pins, props)
  if (current !== pins) {
    setPins(current)
  }
  const openIds = new Set(questions.map((question) => question.id))
  const kept = Object.keys(current).filter((id) => !openIds.has(id))

  // After an answer saves, its form leaves; focus moves to the next form or the drawer heading.
  useEffect(() => {
    // A failed read gives up the move: by the time it recovers, the operator may be elsewhere.
    if (readFailed) {
      answered.current = false
    }
    // Waits while an open question has no form yet, such as before a remount's fresh read.
    const waiting = questions.some((question) => current[question.id] === undefined)
    if (!answered.current || waiting) {
      return
    }
    answered.current = false
    const next = container.current?.querySelector<HTMLElement>('form textarea, form input')
    if (next) {
      next.focus()
      return
    }
    const dialog = container.current?.closest('dialog')
    const headingId = dialog?.getAttribute('aria-labelledby')
    if (headingId) {
      document.getElementById(headingId)?.focus()
    }
  })

  async function answerAndMoveOn(questionId: string, input: ProcessingAnswerDto, key: string) {
    await answer(questionId, input, key)
    answered.current = true
  }

  function form(id: string, pin: Pin) {
    const { question } = pin
    const blocked = otherAnswerDirty(id)

    return (
      <div key={`${id}:${pin.revision}`}>
        {question.spec.kind === 'clarification' && (
          <DisabledFeature explanation={OPTIONS_NOT_CARRIED}>
            {(control) => (
              <Options role="radiogroup" aria-label={`Answer options: ${question.spec.prompt}`}>
                {OPTIONS.map((option) => (
                  <Option key={option.id}>
                    <input type="radio" name={`options-${id}`} {...control} />
                    <span>
                      <strong>{option.title}</strong> <Detail>{option.detail}</Detail>
                    </span>
                  </Option>
                ))}
              </Options>
            )}
          </DisabledFeature>
        )}
        <QuestionAnswer
          label={`Session question: ${question.spec.prompt}`}
          question={question}
          captureRevision={pin.revision}
          currentQuestion={lookup(id)}
          currentCaptureRevision={captureRevision}
          disabled={disabled || saving || blocked}
          blockedReason={
            blocked
              ? 'Save or discard the other answer first; saving it reloads Processing.'
              : undefined
          }
          // Another answer saving reloads Processing, so the rest wait without edits.
          readOnly={readOnly || saving}
          answer={answerAndMoveOn}
          onDirtyChange={reportFor(id)}
        />
      </div>
    )
  }

  // One list, so a form keeps its place (and its draft) when its question stops being open.
  const rows: { id: string; question?: ProcessingQuestionDto }[] = [
    ...questions.map((question) => ({ id: question.id, question })),
    ...kept.map((id) => ({ id })),
  ]

  return (
    <Answers ref={container}>
      {rows.map(({ id, question }) => {
        const pin = current[id]
        if (pin) {
          return form(id, pin)
        }

        return question ? <span key={id}>{fallback(question)}</span> : null
      })}
    </Answers>
  )
}

const Answers = styled.div`
  display: grid;
  gap: ${space[6]};
  min-width: 0;
`

const Options = styled.div`
  display: grid;
  align-self: stretch;
  gap: ${space[3]};
`

// Doubled so it outranks DisabledFeature's own `label` rule.
const Option = styled.label`
  && {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: start;
    gap: ${space[5]};
    padding: ${space[5]} ${space[6]};
    border: 1px solid ${color.lineStrong};
    border-radius: ${radius.btn};
    background: ${color.surface};
  }
`

const Detail = styled.span`
  color: ${color.muted};
  font-size: ${typeVar.small.size};
`
