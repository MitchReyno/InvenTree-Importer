import type { PoolClient } from 'pg'
import type {
  BriefAnswerEntryDto,
  BriefQuestionEntryDto,
  CaptureSnapshotDto,
  SessionAskArgsV2Dto,
} from '@invimport/contracts'
import type { ProcessingConfig } from '#/processing/attempts.ts'
import {
  answerEntry,
  questionEntry,
  readAnswers,
  readQuestions,
  type StoredQuestion,
} from '#/processing/brief.ts'

/** What a `/7` ask rests on besides its sealed question: evidence it names as new, its conflict. */
export interface QuestionBasis {
  evidence: readonly { evidence_id: string; version_id: string }[]
  conflict: string | null
}

/** What an earlier question already covered: the evidence it cited and the conflict it named. */
interface Covered {
  evidence: ReadonlySet<string>
  conflict: string | null
}

/** Conflicts compare by their words, whatever their case and spacing. */
function conflictKey(conflict: string | null) {
  return conflict === null
    ? null
    : conflict.normalize('NFC').toLowerCase().replace(/\s+/gu, ' ').trim()
}

/** The evidence each question showed in its figures or named as new, and the conflict it named. */
async function coveredBy(client: PoolClient, questionIds: readonly string[]) {
  const rows = await client.query<{ id: string; evidence: string[]; conflict: string | null }>(
    `SELECT q.id,
       ARRAY(SELECT f.version_id::text FROM public.processing_question_figure f WHERE f.question_id=q.id
             UNION
             SELECT unnest(b.evidence_version_ids)::text) AS evidence,
       b.conflict
     FROM public.processing_question q
     LEFT JOIN public.processing_question_basis b ON b.question_id=q.id
     WHERE q.id = ANY($1::uuid[])`,
    [[...questionIds]],
  )
  return new Map<string, Covered>(
    rows.rows.map((row) => [row.id, { evidence: new Set(row.evidence), conflict: row.conflict }]),
  )
}

/** Whether an earlier question leaves nothing new for this ask: no new evidence and no new conflict. */
function covers(earlier: Covered | undefined, basis: QuestionBasis) {
  const evidence = earlier?.evidence ?? new Set<string>()
  const newEvidence = basis.evidence.some((named) => !evidence.has(named.version_id))
  const newConflict =
    basis.conflict !== null &&
    conflictKey(basis.conflict) !== conflictKey(earlier?.conflict ?? null)
  return !newEvidence && !newConflict
}

/** An open or answered question about the ask's subject sharing one of its fields. */
function overlaps(question: StoredQuestion, ask: SessionAskArgsV2Dto) {
  const live = question.state === 'open' || question.state === 'answered'
  const sameSubject = question.subjectId === ask.subject_id
  const replaced = question.id === ask.replaces
  return (
    live && sameSubject && !replaced && question.fields.some((field) => ask.fields.includes(field))
  )
}

/**
 * The question a publishing `/7` ask would repeat: the newest open or answered question of the
 * batch about the same subject and an overlapping field that the ask names no new evidence or
 * conflict against, other than the open question it replaces. Null when the ask is new.
 */
export async function coveringQuestion(
  client: PoolClient,
  config: ProcessingConfig,
  snapshot: CaptureSnapshotDto,
  ask: SessionAskArgsV2Dto,
  basis: QuestionBasis,
): Promise<{ question: BriefQuestionEntryDto; answer: BriefAnswerEntryDto | null } | null> {
  const questions = await readQuestions(client, config, snapshot, undefined)
  const candidates = questions.filter((question) => overlaps(question, ask)).reverse()
  if (!candidates.length) {
    return null
  }
  const covered = await coveredBy(
    client,
    candidates.map((question) => question.id),
  )
  const repeated = candidates.find((question) => covers(covered.get(question.id), basis))
  if (!repeated) {
    return null
  }
  const answers = await readAnswers(client, [repeated])
  const answer = answers.get(repeated.id)
  return {
    question: questionEntry(repeated, answers),
    answer: answer ? answerEntry(repeated, answer) : null,
  }
}

/** Keeps what a stored `/7` question rests on, for the next ask to compare against. */
export async function storeQuestionBasis(
  client: PoolClient,
  batchId: string,
  questionId: string,
  basis: QuestionBasis,
) {
  await client.query(
    `INSERT INTO public.processing_question_basis(question_id,batch_id,evidence_version_ids,conflict)
     VALUES ($1,$2,$3::uuid[],$4)`,
    [questionId, batchId, basis.evidence.map((named) => named.version_id), basis.conflict],
  )
}
