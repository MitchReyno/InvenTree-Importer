import type { ProcessingJobDto, ProcessingQuestionDto } from '@invimport/contracts'
import { batchHref, processingStepFor, sessionPageHref } from '#/navigation/batch-route'
import type { ConfirmedAnswer } from './answer-outcomes'
import { answeredLine, newestAnsweredFirst, type AnsweredLine } from './answered-line'

/** One line of the Answered group, with where it links. */
export type AnsweredItem = {
  batchId: string
  line: AnsweredLine
  question: ProcessingQuestionDto
  stage: string
  sessionHref: string
  lot?: { label: string; href: string }
}

type Context = {
  batchId: string
  /** This tab's confirmed answer to a question, if any. */
  confirmed: (questionId: string) => ConfirmedAnswer | undefined
  /** A live lot's label, or undefined for anything else. */
  liveLotLabel: (subjectId: string | null) => string | undefined
  /** The asking session's stage name, as the operator sees it: "Examine". */
  stageName: (job: ProcessingJobDto) => string
}

/** A question answered in the read, or by this tab, which folds into the Answered group. */
export function isAnswered(question: ProcessingQuestionDto, confirmed: Context['confirmed']) {
  return question.state === 'answered' || confirmed(question.id) !== undefined
}

/** The jobs' answered questions as Answered lines, newest answer first. */
export function answeredItems(jobs: readonly ProcessingJobDto[], context: Context): AnsweredItem[] {
  const items = jobs.flatMap((job) =>
    job.questions
      .filter((question) => isAnswered(question, context.confirmed))
      .map((question) => {
        const stage = context.stageName(job)
        const line = answeredLine({
          question,
          confirmed: context.confirmed(question.id),
          sessionState: job.session_state,
          stage,
        })
        const label = context.liveLotLabel(question.subject_id)
        const lot =
          label && question.subject_id
            ? {
                label,
                href: batchHref(context.batchId, {
                  tab: 'review',
                  view: 'lots',
                  lotId: question.subject_id,
                }),
              }
            : undefined
        return {
          batchId: context.batchId,
          line,
          question,
          stage,
          sessionHref: sessionPageHref(context.batchId, processingStepFor(job.stage), job.id),
          ...(lot ? { lot } : {}),
        }
      }),
  )

  return newestAnsweredFirst(items)
}

/** Where a closed question's card links: its replacement's question route, or its session. */
export function closedLinks(
  jobs: readonly ProcessingJobDto[],
  question: ProcessingQuestionDto,
  batchId: string,
) {
  const job = jobs.find((candidate) => candidate.id === question.job_id)
  const step = job ? processingStepFor(job.stage) : undefined
  const replacementHref =
    question.replaced_by && step
      ? batchHref(batchId, { tab: 'processing', step, questionId: question.replaced_by })
      : undefined
  const sessionHref =
    question.session_history && job && step ? sessionPageHref(batchId, step, job.id) : undefined

  return { replacementHref, sessionHref }
}
