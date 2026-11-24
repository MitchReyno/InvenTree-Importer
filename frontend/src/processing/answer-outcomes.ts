import {
  ANSWER_SUMMARY_TEXT_MAX_CHARACTERS,
  type ProcessingAnswerDto,
  type ProcessingQuestionDto,
  type ProcessingAnswerSummaryDto,
} from '@invimport/contracts'

/** One step's answer as an Answered line shows it, in the Processing read's own format. */
export type AnswerValueLine = Extract<ProcessingAnswerSummaryDto, { values: unknown }>['values'][0]

/** An answer this tab sent and the server confirmed, kept until a read shows it answered. */
export type ConfirmedAnswer = {
  questionId: string
  answerId: string
  values: AnswerValueLine[]
  /** When the confirmation arrived; the read's own answer time replaces it. */
  savedAt: string
}

/** Where focus goes once an answered question has folded away. */
export type AnswerFocusTarget = { kind: 'question'; questionId: string } | { kind: 'answered' }

function cut(text: string) {
  const points = [...text]
  if (points.length <= ANSWER_SUMMARY_TEXT_MAX_CHARACTERS) {
    return { text, truncated: false }
  }

  return { text: points.slice(0, ANSWER_SUMMARY_TEXT_MAX_CHARACTERS).join(''), truncated: true }
}

function line(stepId: string | null, prompt: string, text: string): AnswerValueLine {
  const value = cut(text)

  return { step_id: stepId, prompt: cut(prompt).text, text: value.text, truncated: value.truncated }
}

/** What the sent answer said, step by step, as the read summarises a saved one. */
export function sentAnswerValues(
  question: ProcessingQuestionDto,
  input: ProcessingAnswerDto,
): AnswerValueLine[] {
  if ('steps' in question) {
    const sent = input.schema_version === 'bench-intake-answer/2' ? input.steps : []
    return question.steps.flatMap((step) => {
      const value = sent.find((candidate) => candidate.step_id === step.id)?.value
      if (!value) {
        return []
      }
      if (value.kind === 'number') {
        return [line(step.id, step.prompt, `${value.value} · ${value.basis}`)]
      }
      if (value.kind === 'text') {
        return [line(step.id, step.prompt, value.text)]
      }
      if ('other' in value) {
        return [line(step.id, step.prompt, value.other)]
      }
      const options = step.answer.kind === 'choice' ? step.answer.options : []
      const label = options.find((option) => option.id === value.option_id)?.label
      return [line(step.id, step.prompt, label ?? value.option_id)]
    })
  }
  if (input.schema_version !== 'bench-intake-answer/1') {
    return []
  }
  const { value } = input
  const text = value.kind === 'quantity' ? `${value.value} · ${value.basis}` : value.text

  return [line(null, question.spec.prompt, text)]
}

/**
 * The answers this tab confirmed, per batch, and where focus goes next. `Batch` owns one store
 * above Processing's remount key, so a confirmed answer outlives a failed read and a reload: its
 * line shows "Saved" until a fresh read returns the question answered, which then wins.
 */
export function createAnswerOutcomes() {
  const confirmed = new Map<string, ConfirmedAnswer>()
  let focus: AnswerFocusTarget | null = null
  let version = 0
  const listeners = new Set<() => void>()

  const changed = () => {
    version += 1
    listeners.forEach((listener) => listener())
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    version: () => version,
    get: (questionId: string) => confirmed.get(questionId),
    /** Records a confirmed answer and the focus target its handler chose, if it chose one. */
    record(answer: ConfirmedAnswer, next: AnswerFocusTarget | null) {
      confirmed.set(answer.questionId, answer)
      focus = next
      changed()
    },
    /** Drops answers a fresh read now returns answered, in whichever tier carries them. */
    prune(answeredIds: ReadonlySet<string>) {
      const dropped = [...confirmed.keys()].filter((id) => answeredIds.has(id))
      if (dropped.length === 0) {
        return
      }
      dropped.forEach((id) => confirmed.delete(id))
      changed()
    },
    peekFocus: () => focus,
    /** The mounted surface moved focus, or the operator did: nothing is left to move. */
    clearFocus() {
      focus = null
    },
  }
}

export type AnswerOutcomeStore = ReturnType<typeof createAnswerOutcomes>
