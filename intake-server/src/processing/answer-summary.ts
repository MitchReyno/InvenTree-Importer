import {
  ANSWER_SUMMARY_TEXT_MAX_CHARACTERS,
  MAX_ANSWER_SUMMARY_BYTES,
  questionView,
  validate,
  type AnswerDeliveryDto,
  type AnswerEffectDto,
  type ProcessingAnswerDto,
  type ProcessingAnswerSummaryDto,
  type ProcessingQuestionDto,
  type ProcessingQuestionValueDto,
  type SessionAnswerStepValueDto,
} from '@invimport/contracts'
import { canonicalRecord, strictJson } from '@invimport/contracts/json'

/** A value as the asking session receives it: a `/1` value, or one step's delivered value. */
export type DeliveredAnswerValue = ProcessingQuestionValueDto | SessionAnswerStepValueDto

/** What an answer changed: a number sets the lot's quantity, every other value adds one note. */
export function answerEffects(
  values: readonly DeliveredAnswerValue[],
  subjectId: string | null,
): AnswerEffectDto[] {
  const effects: AnswerEffectDto[] = []
  const number = values.find((value) => value.kind === 'quantity' || value.kind === 'number')
  if (number && subjectId && (number.kind === 'quantity' || number.kind === 'number')) {
    effects.push({ kind: 'quantity', lot_id: subjectId, value: number.value, basis: number.basis })
  }
  if (values.some((value) => value.kind !== 'quantity' && value.kind !== 'number')) {
    effects.push({ kind: 'note', subject_id: subjectId })
  }
  return effects
}

/** The stored answer input, as `processing_answer.value_bytes` seals it with its question. */
export function decodeStoredAnswer(bytes: Buffer): ProcessingAnswerDto {
  const { question_id: _questionId, ...input } = strictJson(bytes.toString('utf8')) as Record<
    string,
    unknown
  >
  validate('ProcessingAnswer', input)
  return input as ProcessingAnswerDto
}

interface AnsweredValue {
  stepId: string | null
  prompt: string
  value: DeliveredAnswerValue
}

/** Each step's answer against its question; a `/1` or runner answer is one value. */
export function answeredValues(
  question: ProcessingQuestionDto,
  input: ProcessingAnswerDto,
): AnsweredValue[] {
  if (input.schema_version === 'bench-intake-answer/1') {
    const prompt = 'spec' in question ? question.spec.prompt : questionView(question).title
    return [{ stepId: null, prompt, value: input.value }]
  }
  const steps = questionView(question).steps
  return input.steps.map((answered) => {
    const step = steps.find((candidate) => candidate.id === answered.step_id)
    const value = answered.value
    let delivered: DeliveredAnswerValue = value as DeliveredAnswerValue
    if (value.kind === 'choice' && 'option_id' in value) {
      const options = step?.answer.kind === 'choice' ? step.answer.options : []
      const label = options.find((option) => option.id === value.option_id)?.label
      delivered = { kind: 'choice', option_id: value.option_id, label: label ?? value.option_id }
    }
    return { stepId: answered.step_id, prompt: step?.prompt ?? answered.step_id, value: delivered }
  })
}

/** A value as the Answered line reads it: "186 · counted", an option's label, or the words. */
export function answerValueText(value: DeliveredAnswerValue) {
  if (value.kind === 'quantity' || value.kind === 'number') {
    return `${value.value} · ${value.basis}`
  }
  if (value.kind === 'clarification' || value.kind === 'text') {
    return value.text
  }
  return 'label' in value ? value.label : value.other
}

function cut(text: string, limit: number) {
  const points = [...text]
  return { text: points.slice(0, limit).join(''), cut: points.length > limit }
}

/** Code-point limits tried in turn until a summary fits its byte bound; 0 keeps only its shape. */
const SUMMARY_CUTS = [ANSWER_SUMMARY_TEXT_MAX_CHARACTERS, 160, 120, 80, 40, 20, 10, 0] as const

/** The serialized bytes a member adds to a non-empty question object: `,"answer":…`. */
export function answerMemberBytes(member: ProcessingAnswerSummaryDto) {
  return Buffer.byteLength(canonicalRecord({ answer: member }), 'utf8') - 1
}

export interface AnswerSummaryInput {
  answerId: string
  answeredAt: string
  values: readonly AnsweredValue[]
  effects: AnswerEffectDto[]
  delivery?: AnswerDeliveryDto
}

/**
 * The full answer member, its prompts and texts cut to the first limit at which the member's
 * canonical UTF-8 JSON, escapes included, is at most `MAX_ANSWER_SUMMARY_BYTES`; null if none does.
 */
export function fullAnswerSummary(input: AnswerSummaryInput): ProcessingAnswerSummaryDto | null {
  for (const limit of SUMMARY_CUTS) {
    const member: ProcessingAnswerSummaryDto = {
      answer_id: input.answerId,
      answered_at: input.answeredAt,
      values: input.values.map((value) => {
        const text = cut(answerValueText(value.value), limit)
        return {
          step_id: value.stepId,
          prompt: cut(value.prompt, limit).text,
          text: text.text,
          truncated: text.cut,
        }
      }),
      effects: input.effects,
      ...(input.delivery ? { delivery: input.delivery } : {}),
    }
    if (answerMemberBytes(member) <= MAX_ANSWER_SUMMARY_BYTES) {
      return member
    }
  }
  return null
}

/** Only the time and delivery, when the snapshot has no room for the values. */
export function compactAnswerSummary(input: AnswerSummaryInput): ProcessingAnswerSummaryDto {
  return {
    answered_at: input.answeredAt,
    values_omitted: true,
    ...(input.delivery ? { delivery: input.delivery } : {}),
  }
}

export interface BudgetedAnswer {
  question: { answer?: ProcessingAnswerSummaryDto }
  full: ProcessingAnswerSummaryDto | null
  compact: ProcessingAnswerSummaryDto
  answeredAt: string
}

/**
 * Adds answer members newest first within `room` bytes: the full member while it fits, then the
 * compact one, then none, so an older batch's read degrades rather than failing.
 */
export function budgetAnswers(answers: readonly BudgetedAnswer[], room: number) {
  let left = room
  const newestFirst = [...answers].sort((a, b) => b.answeredAt.localeCompare(a.answeredAt))
  for (const answer of newestFirst) {
    for (const member of [answer.full, answer.compact]) {
      if (!member) {
        continue
      }
      const bytes = answerMemberBytes(member)
      if (bytes <= left) {
        answer.question.answer = member
        left -= bytes
        break
      }
    }
  }
  return left
}
