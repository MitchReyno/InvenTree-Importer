import type { PoolClient } from 'pg'
import {
  BRIEF_SHARED_SECTIONS,
  BRIEF_STAGE_SECTIONS,
  LEGACY_QUESTION_STEP_ID,
  questionView,
  validate,
  type BriefEntryDto,
  type BriefSectionNameDto,
  type BriefStageDto,
  type CaptureEvidenceObservationDto,
  type CaptureSnapshotDto,
  type EvidenceReadingsDto,
  type ProcessingFieldDto,
  type QuestionView,
  type SessionAskArgsDto,
  type SessionAskArgsV2Dto,
  type SessionBriefDto,
  type SessionProposalDto,
} from '@invimport/contracts'
import type { MediaInputContextDto } from '@invimport/contracts/media'
import { sha256 } from '#/db/authority.ts'
import { captureContextNotes } from '#/capture/context-input.ts'
import { currentInstructions } from '#/agents/instructions.ts'
import { answerValueText, answeredValues, decodeStoredAnswer } from './answer-summary.ts'
import { isSessionMessage, retainedQuestionSpec, retainedSessionQuestion } from './retained.ts'
import { fail, unseal } from './model.ts'

/** The fields each stage works on; a question is in its brief when it names one of them. */
const STAGE_FIELDS: Record<BriefStageDto, readonly ProcessingFieldDto[]> = {
  examine: ['markings', 'identity', 'quantity'],
  research: ['markings', 'identity', 'research'],
  images: ['identity', 'images'],
}

/** An evidence version a session may fetch, as its media manifest lists it. */
export interface BriefVersion {
  evidenceId: string
  versionId: string
  digest: string
  mediaType: string
}

/** Who the brief is for and what it may draw on; everything else comes from retained state. */
export interface BriefScope {
  stage: BriefStageDto
  /** The lot of a Research or Images session; null for the batch's Examine lead. */
  lotId: string | null
  versions: readonly BriefVersion[]
  /** The group and evidence notes of the session's media manifest. */
  mediaContext: MediaInputContextDto | undefined
  /** The identity proposals a Research session was pinned to. */
  pinnedProposalIds: readonly string[]
  web: { public_pages: boolean; prefer_datasheets: boolean }
}

interface StoredQuestion {
  id: string
  jobId: string
  subjectId: string | null
  fields: ProcessingFieldDto[]
  state: 'open' | 'answered' | 'superseded'
  view: QuestionView
}

interface StoredAnswer {
  questionId: string
  answerId: string
  actorId: string
  answeredAt: string
  steps: { step_id: string | null; prompt: string; value: string }[]
}

interface StoredCorrection {
  observationId: string
  revision: string
  before: EvidenceReadingsDto
  after: EvidenceReadingsDto
  actorId: string
  correctedAt: string
}

interface StoredIdentity {
  proposalId: string
  proposal: SessionProposalDto
  stale: boolean
}

/** Retained facts a brief draws on besides the capture snapshot, read in the caller's transaction. */
export interface BriefFacts {
  instructions: { id: string; groupId: string | null; text: string }[]
  questions: StoredQuestion[]
  answers: Map<string, StoredAnswer>
  corrections: StoredCorrection[]
  labels: Map<string, string>
  identities: StoredIdentity[]
}

/** The view of a stored question: a runner's or a `/1` session ask reads as one step. */
function storedQuestionView(
  question: SessionAskArgsDto | SessionAskArgsV2Dto | { prompt: string; reason: string },
  assumption: string | null,
): QuestionView {
  if ('steps' in question) {
    return questionView(question)
  }
  return {
    version: 1,
    title: question.prompt,
    reason: question.reason,
    steps: [
      {
        id: LEGACY_QUESTION_STEP_ID,
        prompt: question.prompt,
        assumption,
        answer: { kind: 'text' },
      },
    ],
  }
}

/** The batch's questions, each in its stored version's shape, oldest first. */
async function readQuestions(client: PoolClient, snapshot: CaptureSnapshotDto) {
  const rows = await client.query<{
    id: string
    job_id: string
    job_subject_id: string | null
    state: 'open' | 'answered' | 'superseded'
    replaced: boolean
    spec_bytes: Buffer
    spec_digest: Buffer
    attempt_id: string
    command_id: string
    manifest_digest: Buffer
    envelope_bytes: Buffer
    envelope_digest: Buffer
    disposition: string
  }>(
    `SELECT q.id,q.job_id,j.subject_id AS job_subject_id,q.state,q.spec_bytes,q.spec_digest,
       q.attempt_id,a.command_id,i.manifest_digest,m.envelope_bytes,m.envelope_digest,m.disposition,
       EXISTS (SELECT 1 FROM public.processing_question_replacement r WHERE r.question_id=q.id) AS replaced
     FROM public.processing_question q
     JOIN public.processing_job j ON j.id=q.job_id
     JOIN public.processing_attempt a ON a.id=q.attempt_id
     JOIN public.processing_input i ON i.id=q.input_id
     JOIN public.processing_message m ON m.id=q.message_id
     WHERE q.batch_id=$1
     ORDER BY q.asked_at ASC NULLS LAST,q.id`,
    [snapshot.id],
  )
  const subjects = new Set([...snapshot.lots, ...snapshot.parts].map((subject) => subject.id))
  return rows.rows.map((row): StoredQuestion => {
    const seal = {
      attemptId: row.attempt_id,
      jobId: row.job_id,
      commandId: row.command_id,
      manifestDigest: row.manifest_digest,
      envelopeBytes: row.envelope_bytes,
      envelopeDigest: row.envelope_digest,
      disposition: row.disposition,
      specBytes: row.spec_bytes,
      specDigest: row.spec_digest,
    }
    const state = row.replaced ? 'superseded' : row.state
    if (!isSessionMessage(seal)) {
      const spec = retainedQuestionSpec(
        seal,
        row.job_subject_id ?? fail('retained_question_binding_invalid'),
      )
      return {
        id: row.id,
        jobId: row.job_id,
        subjectId: spec.subject_id,
        fields: [],
        state,
        view: storedQuestionView(spec, null),
      }
    }
    const ask = retainedSessionQuestion(seal, row.job_subject_id, subjects)
    return {
      id: row.id,
      jobId: row.job_id,
      subjectId: ask.subject_id ?? row.job_subject_id,
      fields: [...ask.fields],
      state,
      view: storedQuestionView(ask, 'assumption' in ask ? ask.assumption : null),
    }
  })
}

/** Each answered question's answer, by question, with every step's prompt and value text. */
async function readAnswers(client: PoolClient, questions: readonly StoredQuestion[]) {
  const answered = questions.filter((question) => question.state !== 'open')
  const answers = new Map<string, StoredAnswer>()
  if (!answered.length) {
    return answers
  }
  const rows = await client.query<{
    id: string
    question_id: string
    actor_id: string
    value_bytes: Buffer
    created_at: Date
  }>(
    `SELECT id,question_id,actor_id,value_bytes,created_at FROM public.processing_answer
     WHERE question_id=ANY($1::uuid[])`,
    [answered.map((question) => question.id)],
  )
  const views = new Map(answered.map((question) => [question.id, question.view]))
  for (const row of rows.rows) {
    const values = answeredValues(views.get(row.question_id)!, decodeStoredAnswer(row.value_bytes))
    answers.set(row.question_id, {
      questionId: row.question_id,
      answerId: row.id,
      actorId: row.actor_id,
      answeredAt: row.created_at.toISOString(),
      steps: values.map((value) => ({
        step_id: value.stepId,
        prompt: value.prompt,
        value: answerValueText(value.value),
      })),
    })
  }
  return answers
}

/** Every kept correction of the batch, with its author and time from its capture revision. */
async function readCorrections(client: PoolClient, batchId: string) {
  const rows = await client.query<{
    observation_id: string
    revision: string
    before_readings: EvidenceReadingsDto
    after_readings: EvidenceReadingsDto
    actor_id: string
    created_at: Date
  }>(
    `SELECT c.observation_id,c.revision::text AS revision,c.before_readings,c.after_readings,
       r.actor_id,r.created_at
     FROM public.capture_evidence_observation_correction c
     JOIN public.capture_revision r ON r.batch_id=c.batch_id AND r.revision=c.revision
     WHERE c.batch_id=$1
     ORDER BY c.revision,c.observation_id`,
    [batchId],
  )
  return rows.rows.map((row) => {
    validate('EvidenceReadings', row.before_readings)
    validate('EvidenceReadings', row.after_readings)
    return {
      observationId: row.observation_id,
      revision: row.revision,
      before: row.before_readings,
      after: row.after_readings,
      actorId: row.actor_id,
      correctedAt: row.created_at.toISOString(),
    }
  })
}

/** The labels of the evidence the session may fetch. */
async function readLabels(client: PoolClient, batchId: string, evidenceIds: readonly string[]) {
  if (!evidenceIds.length) {
    return new Map<string, string>()
  }
  const rows = await client.query<{ id: string; label: string }>(
    'SELECT id,label FROM public.media_evidence WHERE batch_id=$1 AND id=ANY($2::uuid[])',
    [batchId, [...new Set(evidenceIds)]],
  )
  return new Map(rows.rows.map((row) => [row.id, row.label]))
}

/** The identity proposals a session was pinned to, as published, with whether each went stale. */
async function readIdentities(client: PoolClient, proposalIds: readonly string[]) {
  if (!proposalIds.length) {
    return []
  }
  const rows = await client.query<{
    id: string
    value_bytes: Buffer
    value_digest: Buffer
    stale: boolean
  }>(
    `SELECT p.id,p.value_bytes,p.value_digest,
       EXISTS (SELECT 1 FROM public.processing_proposal_stale s WHERE s.proposal_id=p.id) AS stale
     FROM public.processing_proposal p WHERE p.id=ANY($1::uuid[]) ORDER BY p.id`,
    [[...proposalIds]],
  )
  return rows.rows.map((row): StoredIdentity => {
    const value = unseal(row.value_bytes, row.value_digest)
    validate('SessionProposal', value)
    return { proposalId: row.id, proposal: value as SessionProposalDto, stale: row.stale }
  })
}

/** Reads the retained facts a brief needs, in the caller's transaction. */
export async function readBriefFacts(
  client: PoolClient,
  snapshot: CaptureSnapshotDto,
  scope: BriefScope,
): Promise<BriefFacts> {
  const instructions = await currentInstructions(client, snapshot.id)
  const questions = await readQuestions(client, snapshot)
  const answers = await readAnswers(client, questions)
  const corrections = await readCorrections(client, snapshot.id)
  const labels = await readLabels(
    client,
    snapshot.id,
    scope.versions.map((version) => version.evidenceId),
  )
  const identities =
    scope.stage === 'research' ? await readIdentities(client, scope.pinnedProposalIds) : []
  return { instructions, questions, answers, corrections, labels, identities }
}

/** The subjects a brief's human facts and questions are about, besides the whole batch. */
function scopedSubjects(snapshot: CaptureSnapshotDto, lotId: string | null) {
  if (lotId === null) {
    return null
  }
  const lot = snapshot.lots.find((item) => item.id === lotId) ?? fail('subject_not_found', 404)
  return new Set([lotId, ...(lot.part_subject_id ? [lot.part_subject_id] : [])])
}

function inScope(subjects: ReadonlySet<string> | null, subjectId: string | null) {
  return subjects === null || subjectId === null || subjects.has(subjectId)
}

/** Notes the operator wrote: on the batch, the lot or its Part, and on its evidence and groups. */
function noteEntries(
  snapshot: CaptureSnapshotDto,
  scope: BriefScope,
  subjects: ReadonlySet<string> | null,
): BriefEntryDto[] {
  const captureNotes = snapshot.notes.filter((note) => inScope(subjects, note.subject_id))
  const contextNotes = scope.lotId ? captureContextNotes(snapshot, scope.lotId) : []
  const mediaNotes = [
    ...(scope.mediaContext?.groups.flatMap((group) => (group.note ? [group.note] : [])) ?? []),
    ...(scope.mediaContext?.evidenceNotes.map((item) => item.note) ?? []),
  ]
    .filter((note) => note.text.trim().length > 0)
    .map((note) => ({ ...note, subject_id: null }))
  return [...captureNotes, ...contextNotes, ...mediaNotes].map((note) => ({
    kind: 'note',
    source: 'human',
    note_id: note.id,
    subject_id: note.subject_id,
    text: note.text,
    text_sha256: sha256(Buffer.from(note.text, 'utf8')).toString('hex'),
    actor_id: note.actor_id,
    created_at: note.created_at,
  }))
}

/**
 * Corrections of the observations in scope. A kept correction shows the reading before and after;
 * an agent observation the operator edited before readings were kept shows its current reading,
 * marked as corrected with the earlier reading not known.
 */
function correctionEntries(
  observations: readonly CaptureEvidenceObservationDto[],
  corrections: readonly StoredCorrection[],
): BriefEntryDto[] {
  const byId = new Map(observations.map((observation) => [observation.id, observation]))
  const kept = corrections.filter((correction) => byId.has(correction.observationId))
  const withKept = new Set(kept.map((correction) => correction.observationId))
  const entries: BriefEntryDto[] = kept.map((correction) => ({
    kind: 'correction',
    source: 'human',
    observation_id: correction.observationId,
    lot_id: byId.get(correction.observationId)!.lot_id,
    before: correction.before,
    after: correction.after,
    earlier_known: true,
    actor_id: correction.actorId,
    corrected_at: correction.correctedAt,
    revision: correction.revision,
  }))
  for (const observation of observations) {
    const earlierUnknown =
      observation.origin === 'agent' &&
      observation.operator_edited &&
      observation.status === 'active' &&
      !withKept.has(observation.id)
    if (earlierUnknown) {
      entries.push({
        kind: 'correction',
        source: 'human',
        observation_id: observation.id,
        lot_id: observation.lot_id,
        before: null,
        after: observation.readings,
        earlier_known: false,
        actor_id: null,
        corrected_at: null,
        revision: null,
      })
    }
  }
  return entries
}

/** Lots the operator made or edited, as they stand now. */
function lotEditEntries(
  snapshot: CaptureSnapshotDto,
  subjects: ReadonlySet<string> | null,
): BriefEntryDto[] {
  return snapshot.lots
    .filter((lot) => (lot.origin !== 'agent' || lot.operator_edited) && inScope(subjects, lot.id))
    .map((lot) => ({
      kind: 'lot_edit',
      source: 'human',
      edit_id: `lot:${lot.id}@${lot.revision}`,
      lot_id: lot.id,
      lot_revision: lot.revision,
      label: lot.label,
      quantity: lot.quantity,
      part_subject_id: lot.part_subject_id,
      excluded: lot.excluded ?? null,
    }))
}

function answerEntries(
  questions: readonly StoredQuestion[],
  answers: ReadonlyMap<string, StoredAnswer>,
): BriefEntryDto[] {
  return questions.flatMap((question): BriefEntryDto[] => {
    const answer = answers.get(question.id)
    if (!answer) {
      return []
    }
    return [
      {
        kind: 'answer',
        source: 'human',
        question_id: question.id,
        answer_id: answer.answerId,
        subject_id: question.subjectId,
        actor_id: answer.actorId,
        answered_at: answer.answeredAt,
        steps: answer.steps,
      },
    ]
  })
}

/** Questions on the subject, its Part or the batch whose fields overlap the stage's. */
function askedEntries(
  questions: readonly StoredQuestion[],
  answers: ReadonlyMap<string, StoredAnswer>,
  stage: BriefStageDto,
): BriefEntryDto[] {
  return questions
    .filter(
      (question) =>
        question.fields.length === 0 ||
        question.fields.some((field) => STAGE_FIELDS[stage].includes(field)),
    )
    .map((question) => ({
      kind: 'question',
      question_id: question.id,
      job_id: question.jobId,
      subject_id: question.subjectId,
      fields: question.fields,
      state: question.state,
      title: question.view.title,
      steps: question.view.steps.map((step) => ({
        id: step.id,
        prompt: step.prompt,
        assumption: step.assumption,
      })),
      answer_id: answers.get(question.id)?.answerId ?? null,
    }))
}

/** The versions the session may fetch, with every region an earlier stage read in each. */
function evidenceEntries(
  scope: BriefScope,
  observations: readonly CaptureEvidenceObservationDto[],
  labels: ReadonlyMap<string, string>,
): BriefEntryDto[] {
  return scope.versions.map((version) => ({
    kind: 'evidence',
    evidence_id: version.evidenceId,
    version_id: version.versionId,
    sha256: version.digest,
    media_type: version.mediaType,
    label: labels.get(version.evidenceId) ?? null,
    regions: observations
      .filter(
        (observation) =>
          observation.status === 'active' && observation.evidence_version_id === version.versionId,
      )
      .map((observation) => ({
        observation_id: observation.id,
        page: observation.page,
        region: observation.region,
        lot_id: observation.lot_id,
      })),
  }))
}

function lotEntries(
  snapshot: CaptureSnapshotDto,
  corrections: readonly BriefEntryDto[],
): BriefEntryDto[] {
  const observations = snapshot.evidence_observations ?? []
  return snapshot.lots.map((lot) => ({
    kind: 'lot',
    lot_id: lot.id,
    label: lot.label,
    origin: lot.origin ?? 'operator',
    operator_edited: lot.operator_edited === true,
    retired: lot.retired === true,
    excluded: lot.excluded ?? null,
    reexamine: lot.reexamine === true,
    corrected_observation_ids: [
      ...new Set(
        corrections.flatMap((entry) =>
          entry.kind === 'correction' && entry.lot_id === lot.id ? [entry.observation_id] : [],
        ),
      ),
    ],
    part_subject_id: lot.part_subject_id,
    estimated_quantity: lot.estimated_quantity ?? null,
    quantity_basis: lot.quantity_basis ?? null,
    observation_set_version: lot.observation_set_version ?? null,
    observation_ids: lot.evidence_observation_ids ?? [],
    suggested_observation_ids: observations
      .filter((observation) => observation.suggested_lot_ids.includes(lot.id))
      .map((observation) => observation.id),
  }))
}

/** Another lot's items on the lot's evidence pages, for Images to keep out of frame. */
function keepOutEntries(
  lotId: string,
  lotObservations: readonly CaptureEvidenceObservationDto[],
  observations: readonly CaptureEvidenceObservationDto[],
): BriefEntryDto[] {
  const pages = new Set(
    lotObservations.map((observation) => `${observation.evidence_version_id}:${observation.page}`),
  )
  return observations
    .filter(
      (observation) =>
        observation.status === 'active' &&
        observation.lot_id !== lotId &&
        pages.has(`${observation.evidence_version_id}:${observation.page}`),
    )
    .map((observation) => ({
      kind: 'keep_out',
      observation_id: observation.id,
      lot_id: observation.lot_id,
      evidence_version_id: observation.evidence_version_id,
      page: observation.page,
      region: observation.region,
      markings: observation.readings.markings,
    }))
}

/**
 * The brief, projected from a capture snapshot and the retained facts; no clock or stream cursor
 * contributes. Sections come in a fixed order and each lists its entries in a stable order.
 */
export function projectBrief(
  snapshot: CaptureSnapshotDto,
  scope: BriefScope,
  facts: BriefFacts,
): SessionBriefDto {
  const subjects = scopedSubjects(snapshot, scope.lotId)
  const allObservations = snapshot.evidence_observations ?? []
  const lot = scope.lotId ? snapshot.lots.find((item) => item.id === scope.lotId) : undefined
  const lotObservationIds = new Set(lot?.evidence_observation_ids ?? [])
  const scopedObservations =
    scope.lotId === null
      ? allObservations
      : allObservations.filter((observation) => lotObservationIds.has(observation.id))
  const questions = facts.questions.filter((question) => inScope(subjects, question.subjectId))
  const corrections = correctionEntries(scopedObservations, facts.corrections)
  const sections: Record<BriefSectionNameDto, BriefEntryDto[]> = {
    batch: [
      {
        kind: 'batch',
        batch_id: snapshot.id,
        title: snapshot.title,
        defaults: snapshot.defaults,
        instructions: facts.instructions.map((instruction) => ({
          instruction_id: instruction.id,
          group_id: instruction.groupId,
          text: instruction.text,
        })),
        web: { ...scope.web },
      },
    ],
    human: [
      ...noteEntries(snapshot, scope, subjects),
      ...answerEntries(questions, facts.answers),
      ...corrections,
      ...lotEditEntries(snapshot, subjects),
    ],
    asked: askedEntries(questions, facts.answers, scope.stage),
    evidence: evidenceEntries(scope, allObservations, facts.labels),
    // Match state arrives with the Match step; the section exists, empty, until then.
    match: [],
    observations: scopedObservations.map((observation) => ({ kind: 'observation', observation })),
    lots: scope.stage === 'examine' ? lotEntries(snapshot, corrections) : [],
    identity: facts.identities.map((identity) => ({
      kind: 'identity',
      proposal_id: identity.proposalId,
      stale: identity.stale,
      proposal: identity.proposal,
    })),
    // The catalogue vocabulary arrives with the stage packs; empty until then.
    vocabulary: [],
    keep_out:
      scope.stage === 'images' && scope.lotId
        ? keepOutEntries(scope.lotId, scopedObservations, allObservations)
        : [],
  }
  const names = [...BRIEF_SHARED_SECTIONS, ...BRIEF_STAGE_SECTIONS[scope.stage]]
  const brief = {
    schema_version: 'bench-intake-brief/1' as const,
    stage: scope.stage,
    lot_id: scope.lotId,
    revision: snapshot.revision,
    sections: names.map((name) => ({ name, count: sections[name].length })),
    entries: names.flatMap((name) => sections[name]),
  }
  validate('SessionBrief', brief)
  return brief
}

/** Reads the facts and projects the brief, in the caller's transaction. */
export async function assembleBrief(
  client: PoolClient,
  snapshot: CaptureSnapshotDto,
  scope: BriefScope,
): Promise<SessionBriefDto> {
  return projectBrief(snapshot, scope, await readBriefFacts(client, snapshot, scope))
}
