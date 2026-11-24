import {
  oldestQuestionFirst,
  questionView,
  type AnswerDeliveryDto,
  type AnswerEffectDto,
  type ProcessingQuestionDto,
  type SessionStateDto,
} from '@invimport/contracts'
import type { AnswerValueLine, ConfirmedAnswer } from './answer-outcomes'

/** The clock while the answer waits in the session's inbox, the tick once the session read it. */
export type AnsweredIcon = 'clock' | 'tick' | 'saved' | 'answered'

/** One answered question's folded line and what it expands to. */
export type AnsweredLine = {
  questionId: string
  title: string
  icon: AnsweredIcon
  /** What was answered, or null when the read had no room for its values. */
  answer: { verb: 'You chose' | 'You answered'; text: string } | null
  /** The delivery or fallback words after the answer; none for an earlier runner's answer. */
  status: string | null
  /** When the session read it, when the read gives a time. */
  readAt: string | null
  answeredAt: string | null
  values: AnswerValueLine[] | null
  effects: AnswerEffectDto[]
  delivery: AnswerDeliveryDto | null
  /** The job's session page exists, so the line links to it. */
  sessionHistory: boolean
}

type LineInput = {
  question: ProcessingQuestionDto
  /** This tab's confirmed answer, shown until a read returns the question answered. */
  confirmed?: ConfirmedAnswer
  /** The asking session's state, which says whether it reads its inbox soon. */
  sessionState?: SessionStateDto
  /** The asking session's stage name, as the operator sees it: "Examine". */
  stage: string
}

function answerWords(question: ProcessingQuestionDto, values: AnswerValueLine[]) {
  const text = values
    .map((value) => (value.truncated ? `${value.text}…` : value.text))
    .join(' · ')
  const steps = 'steps' in question ? question.steps : []
  const choice = steps.length === 1 && steps[0].answer.kind === 'choice'

  return { verb: choice ? ('You chose' as const) : ('You answered' as const), text }
}

function deliveryWords(delivery: AnswerDeliveryDto, stage: string, sessionState?: SessionStateDto) {
  if (delivery.state === 'read') {
    return `${stage} read it`
  }
  // A session reads its inbox while it runs; otherwise only once it is resumed.
  return sessionState === 'running'
    ? `waiting for ${stage} to read it`
    : `${stage} will read it when it resumes`
}

function deliveryIcon(delivery: AnswerDeliveryDto | null): AnsweredIcon {
  if (!delivery) {
    return 'answered'
  }

  return delivery.state === 'read' ? 'tick' : 'clock'
}

/** An answered question as one line: the read's answer when it has one, else this tab's. */
export function answeredLine({ question, confirmed, sessionState, stage }: LineInput): AnsweredLine {
  const title = questionView(question).title
  const sessionHistory = question.session_history === true
  const summary = question.state === 'answered' ? question.answer : undefined
  const base = { questionId: question.id, title, sessionHistory, effects: [] }
  if (question.state !== 'answered' && confirmed) {
    // Saved, but no read has returned it answered yet, so nothing is known of its delivery.
    return {
      ...base,
      icon: 'saved',
      answer: answerWords(question, confirmed.values),
      status: 'saved',
      readAt: null,
      answeredAt: confirmed.savedAt,
      values: confirmed.values,
      delivery: null,
    }
  }
  const fallback = sessionHistory ? 'Answered · see the session' : 'Answered · details not shown'
  if (!summary) {
    // The oldest answers, when even their time had no room: only the answered state is known.
    return {
      ...base,
      icon: 'answered',
      answer: null,
      status: fallback,
      readAt: null,
      answeredAt: null,
      values: null,
      delivery: null,
    }
  }
  const delivery = summary.delivery ?? null
  const status = delivery ? deliveryWords(delivery, stage, sessionState) : null
  if ('values_omitted' in summary) {
    return {
      ...base,
      icon: deliveryIcon(delivery),
      answer: null,
      status: status ? `${fallback} · ${status}` : fallback,
      readAt: delivery?.read_at ?? null,
      answeredAt: summary.answered_at,
      values: null,
      delivery,
    }
  }

  return {
    ...base,
    icon: deliveryIcon(delivery),
    answer: answerWords(question, summary.values),
    // An earlier runner's answer has no inbox, so its line says nothing about reading.
    status,
    readAt: delivery?.read_at ?? null,
    answeredAt: summary.answered_at,
    values: summary.values,
    effects: summary.effects,
    delivery,
  }
}

/**
 * The Answered group's order: newest answer first; answers with no time follow, in the order
 * they were asked.
 */
export function newestAnsweredFirst<T extends { line: AnsweredLine; question: ProcessingQuestionDto }>(
  lines: readonly T[],
): T[] {
  return [...lines].sort((a, b) => {
    const left = a.line.answeredAt
    const right = b.line.answeredAt
    if (left && right) {
      return Date.parse(right) - Date.parse(left)
    }
    if (left || right) {
      return left ? -1 : 1
    }
    return oldestQuestionFirst(a.question, b.question)
  })
}
