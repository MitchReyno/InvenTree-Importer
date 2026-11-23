import {
  CAPTURE_NOTE_MAX_CHARACTERS,
  type ProcessingAnswerV2Dto,
  type QuestionStepDto,
  type QuestionStepValueDto,
  type SessionAnswerStepValueDto,
  type SessionAskArgsV2Dto,
} from '@invimport/contracts'
import { storableText } from '#/db/storable-text.ts'
import { fail, failStep } from './model.ts'

/** What a `/2` answer changes: at most a lot quantity and one note, and what the session is told. */
export interface SteppedAnswerEffects {
  quantity?: { value: string; basis: 'counted' | 'estimated' }
  /** One line per choice or text step, and per number step answered in words. */
  note?: string
  delivered: { step_id: string; value: SessionAnswerStepValueDto }[]
}

interface StepOutcome {
  delivered: SessionAnswerStepValueDto
  /** The text the step's note line pairs with its prompt; absent for a quantity. */
  noteText?: string
}

function choiceOutcome(step: QuestionStepDto, value: QuestionStepValueDto): StepOutcome {
  if (step.answer.kind !== 'choice' || value.kind !== 'choice') {
    return failStep(step.id)
  }
  if ('option_id' in value) {
    const option =
      step.answer.options.find((candidate) => candidate.id === value.option_id) ?? failStep(step.id)
    return {
      delivered: { kind: 'choice', option_id: option.id, label: option.label },
      noteText: option.label,
    }
  }
  if (!step.answer.other) {
    return failStep(step.id)
  }
  return { delivered: value, noteText: value.other }
}

function stepOutcome(step: QuestionStepDto, value: QuestionStepValueDto): StepOutcome {
  switch (step.answer.kind) {
    case 'choice':
      return choiceOutcome(step, value)
    case 'number':
      if (value.kind === 'number') {
        return { delivered: value }
      }
      // A number the operator can't give is answered in words and leaves the quantity alone.
      if (value.kind === 'text') {
        return { delivered: value, noteText: value.text }
      }
      return failStep(step.id)
    case 'text':
      if (value.kind !== 'text') {
        return failStep(step.id)
      }
      return { delivered: value, noteText: value.text }
  }
}

/** Every Unicode hard line break: LF, VT, FF, CR, NEL, LS and PS. */
const LINE_BREAKS = /\s*[\n\v\f\r\u0085\u2028\u2029]+\s*/g

/** A note line per step: line breaks inside a prompt or answer become spaces. */
function oneLine(text: string) {
  return text.replace(LINE_BREAKS, ' ')
}

/** Code points, as JSON Schema's `maxLength` counts the capture note. */
function noteCharacters(text: string) {
  return [...text].length
}

function valuesByStep(input: ProcessingAnswerV2Dto, ask: SessionAskArgsV2Dto) {
  const known = new Set(ask.steps.map((step) => step.id))
  const values = new Map<string, QuestionStepValueDto>()
  for (const step of input.steps) {
    if (!known.has(step.step_id)) {
      fail('invalid_answer', 422)
    }
    if (values.has(step.step_id)) {
      failStep(step.step_id)
    }
    values.set(step.step_id, step.value)
  }
  return values
}

/**
 * Checks a `/2` answer against its stored question and derives its effects, before any edit: one
 * value per step of the step's kind, known options, "Something else" only where allowed, and a
 * combined note within the capture note limit.
 */
export function steppedAnswerEffects(
  ask: SessionAskArgsV2Dto,
  input: ProcessingAnswerV2Dto,
): SteppedAnswerEffects {
  const values = valuesByStep(input, ask)
  const delivered: SteppedAnswerEffects['delivered'] = []
  const lines: string[] = []
  let quantity: SteppedAnswerEffects['quantity']
  for (const step of ask.steps) {
    const value = values.get(step.id) ?? failStep(step.id)
    const outcome = stepOutcome(step, value)
    delivered.push({ step_id: step.id, value: outcome.delivered })
    if (outcome.delivered.kind === 'number') {
      quantity = { value: outcome.delivered.value, basis: outcome.delivered.basis }
    }
    if (outcome.noteText !== undefined) {
      // The note and the delivered payload are stored as text, which refuses these characters.
      if (!storableText(outcome.noteText)) {
        failStep(step.id)
      }
      // The session still receives the text as written.
      lines.push(`${oneLine(step.prompt)} — ${oneLine(outcome.noteText)}`)
      if (noteCharacters(lines.join('\n')) > CAPTURE_NOTE_MAX_CHARACTERS) {
        failStep(step.id)
      }
    }
  }
  return {
    ...(quantity ? { quantity } : {}),
    ...(lines.length ? { note: lines.join('\n') } : {}),
    delivered,
  }
}
