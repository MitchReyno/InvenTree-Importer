import {
  validate,
  type ProcessingAnswerV2Dto,
  type ProcessingQuestionV2Dto,
  type QuestionStepValueDto,
  type QuestionViewStep,
} from '@invimport/contracts'

/** The choice a "Something else…" pick stands for; an agent's option IDs can't start with `_`. */
export const OTHER_OPTION = '_other'

/** The longest text a step's answer may hold, as the answer contract allows. */
export const STEP_TEXT_MAX_CHARACTERS = 2048

export type ChoiceDraft = { kind: 'choice'; option: string; other: string }
export type NumberDraft = {
  kind: 'number'
  value: string
  basis: 'counted' | 'estimated'
  /** The operator can't give a number and answers in words; the quantity stays as it is. */
  inWords: boolean
  words: string
}
export type TextDraft = { kind: 'text'; text: string }
export type StepDraft = ChoiceDraft | NumberDraft | TextDraft

export function emptyDraft(step: QuestionViewStep): StepDraft {
  switch (step.answer.kind) {
    case 'choice':
      return { kind: 'choice', option: '', other: '' }
    case 'number':
      return { kind: 'number', value: '', basis: 'counted', inWords: false, words: '' }
    case 'text':
      return { kind: 'text', text: '' }
  }
}

/** Something has been typed or picked, so leaving would lose it. */
export function draftStarted(draft: StepDraft) {
  switch (draft.kind) {
    case 'choice':
      return draft.option !== '' || draft.other !== ''
    case 'number':
      return draft.value !== '' || draft.words !== '' || draft.basis !== 'counted' || draft.inWords
    case 'text':
      return draft.text !== ''
  }
}

function wordsGiven(text: string) {
  return text.trim() !== '' && [...text].length <= STEP_TEXT_MAX_CHARACTERS
}

/** A quantity as the answer contract takes it: exact, positive, at most six decimal places. */
export function validQuantity(value: string) {
  try {
    validate('QuestionStepValue', { kind: 'number', value, basis: 'counted' })
    return true
  } catch {
    return false
  }
}

/** The plain fix shown under a number field while what's typed isn't a quantity. */
export const NUMBER_FIX =
  'Enter just the number, like 380. Choose “Estimated” if it isn’t an exact count.'

/** Whether a step's draft can be sent; Next and Send wait until it can. */
export function stepComplete(draft: StepDraft) {
  switch (draft.kind) {
    case 'choice':
      return draft.option === OTHER_OPTION ? wordsGiven(draft.other) : draft.option !== ''
    case 'number':
      return draft.inWords ? wordsGiven(draft.words) : validQuantity(draft.value)
    case 'text':
      return wordsGiven(draft.text)
  }
}

export function stepValue(draft: StepDraft): QuestionStepValueDto {
  switch (draft.kind) {
    case 'choice':
      return draft.option === OTHER_OPTION
        ? { kind: 'choice', other: draft.other }
        : { kind: 'choice', option_id: draft.option }
    case 'number':
      return draft.inWords
        ? { kind: 'text', text: draft.words }
        : { kind: 'number', value: draft.value, basis: draft.basis }
    case 'text':
      return { kind: 'text', text: draft.text }
  }
}

/** One answer with every step's value, checked against the same contract the server uses. */
export function steppedAnswerInput(
  question: ProcessingQuestionV2Dto,
  captureRevision: string,
  drafts: readonly StepDraft[],
): ProcessingAnswerV2Dto {
  const input: ProcessingAnswerV2Dto = {
    schema_version: 'bench-intake-answer/2',
    expected_question_revision: question.revision,
    expected_capture_revision: captureRevision,
    attempt_id: question.attempt_id,
    input_sha256: question.input_sha256,
    steps: question.steps.map((step, index) => ({
      step_id: step.id,
      value: stepValue(drafts[index]),
    })),
  }
  validate('ProcessingAnswer', input)
  return Object.freeze(input)
}
