import type { ProcessingQuestionDto, QuestionStepAnswerDto } from './processing.ts'
import type { SessionAskArgsV2Dto } from './sessions.ts'

/** One step as every reader shows it, whatever the question's version. */
export interface QuestionViewStep {
  id: string
  prompt: string
  /** Null for an earlier runner question, which recorded no assumption. */
  assumption: string | null
  answer: QuestionStepAnswerDto
  /** A `/1` question's own kind, which its `/1` answer repeats. */
  legacy_kind?: 'quantity' | 'clarification'
}

export interface QuestionView {
  version: 1 | 2
  title: string
  reason: string
  steps: QuestionViewStep[]
}

/** The step ID a `/1` question's single step reads as; `/1` answers carry no step IDs. */
export const LEGACY_QUESTION_STEP_ID = 'answer'

/** A `/2` question's content, from the read model or the stored ask. */
type SteppedQuestion = Pick<SessionAskArgsV2Dto, 'title' | 'reason' | 'steps'>

function steppedView(question: SteppedQuestion): QuestionView {
  return {
    version: 2,
    // A one-step question is labelled by its prompt; a title labels a stepped question.
    title:
      question.steps.length === 1
        ? question.steps[0].prompt
        : (question.title ?? question.steps[0].prompt),
    reason: question.reason,
    steps: question.steps.map((step) => ({
      id: step.id,
      prompt: step.prompt,
      assumption: step.assumption,
      answer: step.answer,
    })),
  }
}

/**
 * The normalised view of a question. A `/1` question reads as one number or text step carrying its
 * original kind, so one renderer serves both versions.
 */
export function questionView(question: ProcessingQuestionDto | SessionAskArgsV2Dto): QuestionView {
  if ('steps' in question) {
    return steppedView(question)
  }
  const { spec } = question
  return {
    version: 1,
    title: spec.prompt,
    reason: spec.reason,
    steps: [
      {
        id: LEGACY_QUESTION_STEP_ID,
        prompt: spec.prompt,
        assumption: question.assumption ?? null,
        answer: { kind: spec.kind === 'quantity' ? 'number' : 'text' },
        legacy_kind: spec.kind,
      },
    ],
  }
}
