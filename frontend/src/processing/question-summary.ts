import { IntakeRequestError } from '@invimport/contracts/client'
import type {
  QuestionStepAnswerDto,
  QuestionStepValueDto,
  SessionAnswerPayloadDto,
  SessionAnswerStepValueDto,
} from '@invimport/contracts'

/** A step as Needs you and the attention read describe it: its kind and how many options. */
type StepKind = { kind: QuestionStepAnswerDto['kind']; options?: number }

/** "3 steps", "choose one of 2", "a number" or "in words", after the question's title. */
export function questionKindLabel(steps: readonly StepKind[]) {
  if (steps.length > 1) {
    return `${steps.length} steps`
  }
  const [step] = steps
  switch (step.kind) {
    case 'choice':
      return `choose one of ${step.options}`
    case 'number':
      return 'a number'
    case 'text':
      return 'in words'
  }
}

export function stepKinds(steps: readonly { answer: QuestionStepAnswerDto }[]): StepKind[] {
  return steps.map(({ answer }) =>
    answer.kind === 'choice' ? { kind: 'choice', options: answer.options.length } : answer,
  )
}

/** The agent's assumptions, one per step where it recorded one; null when it recorded none. */
export function assumptionLine(assumptions: readonly (string | null)[]) {
  const recorded = assumptions.filter((assumption): assumption is string => Boolean(assumption))

  return recorded.length ? recorded.join(' · ') : null
}

type AnswerValue = QuestionStepValueDto | SessionAnswerStepValueDto

/** One step's answer in words, with a choice's label looked up when the value carries none. */
export function stepAnswerText(value: AnswerValue, optionLabel?: (id: string) => string) {
  switch (value.kind) {
    case 'choice':
      if ('option_id' in value) {
        return 'label' in value ? value.label : (optionLabel?.(value.option_id) ?? value.option_id)
      }
      return value.other
    case 'number':
      return `${value.value} ${value.basis}`
    case 'text':
      return value.text
  }
}

/** What an answer said, for the chat: one value, or each step's in order. */
export function answerPayloadText(payload: SessionAnswerPayloadDto) {
  if ('steps' in payload) {
    return payload.steps.map((step) => stepAnswerText(step.value)).join(' · ')
  }
  const { value } = payload

  return value.kind === 'quantity' ? value.value : value.text
}

/**
 * The server read the answer and refused it, so nothing was saved and the draft can be fixed. Any
 * other failure leaves the outcome unknown, and only the exact answer may be sent again.
 */
export function confirmedAnswerRefusal(failure: unknown): IntakeRequestError | null {
  const refused =
    failure instanceof IntakeRequestError &&
    failure.status === 422 &&
    failure.code === 'invalid_answer'

  return refused ? failure : null
}
