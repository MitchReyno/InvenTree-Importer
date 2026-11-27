import { strictJson } from '@invimport/contracts/json'
import { validate } from '@invimport/contracts'
import { sha256 } from '#/db/authority.ts'
import type { MatchQuestionContent } from './questions.ts'
import type { processingMatchQuestions } from './schema.ts'

/** A question's content as stored: what it asked and quoted when it opened. */
export type StoredQuestion = MatchQuestionContent

type QuestionRow = typeof processingMatchQuestions.$inferSelect

/** A stored question's content, verified against its digest and checked field by field. */
export function decodeQuestionContent(row: QuestionRow): StoredQuestion {
  if (!sha256(row.questionBytes).equals(row.questionDigest)) {
    throw new Error('match_question_corrupt')
  }
  const value = strictJson(row.questionBytes.toString('utf8')) as StoredQuestion | null
  if (!value || typeof value !== 'object' || value.kind !== row.kind) {
    throw new Error('match_question_corrupt')
  }
  if (!Array.isArray(value.steps) || value.steps.length !== 1) {
    throw new Error('match_question_corrupt')
  }
  validate('QuestionStep', value.steps[0])
  for (const key of value.keys) {
    validate('MatchKey', key)
  }
  for (const candidate of value.candidates) {
    validate('MatchCandidate', candidate)
  }
  return value
}
