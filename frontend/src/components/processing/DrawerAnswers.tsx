import { useEffect, useRef, useState, type ReactNode } from 'react'
import styled from 'styled-components'
import type { ProcessingAnswerDto, ProcessingQuestionDto } from '@invimport/contracts'
import { DisabledFeature } from '#/components/ui'
import { color, radius, space, typeVar } from '#/theme/generated/tokens'
import { QuestionAnswer } from './QuestionAnswer'

const OPTIONS_NOT_CARRIED =
  'Questions don’t carry the session’s answer options yet, so answer in words below.'

/** The canvas's two choices for a question about an existing InvenTree record. */
const OPTIONS = [
  { id: 'same', title: 'Same as the InvenTree record', detail: 'Use the existing one' },
  { id: 'different', title: 'Different', detail: 'Add it as new' },
]

type Props = {
  /** The session's open questions, from the latest Processing read. */
  questions: ProcessingQuestionDto[]
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
}

/**
 * A session drawer's open questions, answered in place. Each form pins its question and capture
 * revision from a fresh read, and keeps them while its draft is unsaved; a clean form follows the
 * revision another answer moved, so it stays answerable. A failed read never unmounts a form.
 */
export function DrawerAnswers({
  questions,
  captureRevision,
  fresh,
  disabled,
  readOnly,
  saving,
  isDirty,
  otherAnswerDirty,
  answer,
  reportFor,
  fallback,
}: Props) {
  const [pins, setPins] = useState<Readonly<Record<string, string>>>({})
  const container = useRef<HTMLDivElement>(null)
  const answered = useRef(false)

  const nextPins: Record<string, string> = { ...pins }
  let repinned = false
  for (const question of questions) {
    const pin = pins[question.id]
    const follows = pin !== undefined && pin !== captureRevision && !isDirty(question.id) && !saving
    if (fresh && (pin === undefined || follows)) {
      nextPins[question.id] = captureRevision
      repinned = true
    }
  }
  if (repinned) {
    setPins(nextPins)
  }

  // After an answer saves, its form leaves; focus moves to the next form or the drawer heading.
  useEffect(() => {
    if (!answered.current) {
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

  return (
    <Answers ref={container}>
      {questions.map((question) => {
        const pin = nextPins[question.id]
        if (pin === undefined) {
          return <span key={question.id}>{fallback(question)}</span>
        }
        const blocked = otherAnswerDirty(question.id)

        return (
          <div key={`${question.id}:${pin}`}>
            {question.spec.kind === 'clarification' && (
              <DisabledFeature explanation={OPTIONS_NOT_CARRIED}>
                {(control) => (
                  <Options role="radiogroup" aria-label={`Answer options: ${question.spec.prompt}`}>
                    {OPTIONS.map((option) => (
                      <Option key={option.id}>
                        <input type="radio" name={`options-${question.id}`} {...control} />
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
              captureRevision={pin}
              currentQuestion={question}
              currentCaptureRevision={captureRevision}
              disabled={disabled || saving || blocked}
              blockedReason={
                blocked
                  ? 'Save or discard the other answer first; saving it reloads Processing.'
                  : undefined
              }
              readOnly={readOnly}
              answer={answerAndMoveOn}
              onDirtyChange={reportFor(question.id)}
            />
          </div>
        )
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
  gap: ${space[3]};
  margin-bottom: ${space[4]};
`

const Option = styled.label`
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: ${space[5]};
  padding: ${space[5]} ${space[6]};
  border: 1px solid ${color.lineStrong};
  border-radius: ${radius.btn};
  background: ${color.surface};
`

const Detail = styled.span`
  color: ${color.muted};
  font-size: ${typeVar.small.size};
`
