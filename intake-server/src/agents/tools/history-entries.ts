import type { PoolClient } from 'pg'
import {
  questionView,
  type CaptureSnapshotDto,
  type EvidenceReadingsDto,
  type EvidenceRegionDto,
  type ProcessingInputV6Dto,
  type SessionAnswerPayloadDto,
  type SessionAskArgsDto,
  type SessionAskArgsV2Dto,
  type SessionHistoryDetailsDto,
  type SessionHistoryEntryDto,
  type SessionHistoryLinkDto,
  type SessionInboxItemDto,
  type SessionOutboxItemDto,
  type SessionProposalDto,
} from '@invimport/contracts'
import { fail } from '#/processing/model.ts'
import { decodeSessionInput } from '#/processing/session-input.ts'
import { retainedSessionProposal, retainedSessionQuestion } from '#/processing/retained.ts'
import { proposalCurrentnessFacts } from '#/processing/read.ts'
import { removedEvidenceIds } from '#/media/removal.ts'

/** The session job a history page belongs to. */
export interface HistoryJob {
  id: string
  batchId: string
  stage: 'examine' | 'research' | 'images' | 'inventory'
  subjectId: string | null
  currentAttemptId: string
}

/** One stored row of the page, validated against its stream's contract. */
export type HistoryRow =
  | { stream: 'outbox'; item: SessionOutboxItemDto; attemptNumber: number }
  | {
      stream: 'inbox'
      item: SessionInboxItemDto
      actorId: string | null
      idempotencyKey: string
    }

interface HistoryContext {
  job: HistoryJob
  capture: CaptureSnapshotDto
  ackedSeq: bigint
}

type OutboxOf<K extends SessionOutboxItemDto['kind']> = Extract<SessionOutboxItemDto, { kind: K }>
type InboxOf<K extends SessionInboxItemDto['kind']> = Extract<SessionInboxItemDto, { kind: K }>
type CurrentObservation = NonNullable<
  Extract<SessionHistoryDetailsDto, { kind: 'observation' }>['current']
>
type SessionAsk = SessionAskArgsDto | SessionAskArgsV2Dto
type Currentness = Extract<SessionHistoryDetailsDto, { kind: 'proposal' }>['currentness']

const SUMMARY_MAX_CHARACTERS = 300
const LABEL_MAX_CHARACTERS = 256

/** One line of at most `max` code points, as the contract counts them. */
function oneLine(text: string, max = SUMMARY_MAX_CHARACTERS) {
  const flat = text.replace(/\s+/gu, ' ').trim()
  const characters = [...flat]
  if (characters.length <= max) {
    return flat || '…'
  }
  return `${characters.slice(0, max - 1).join('')}…`
}

function outboxEntryId(item: SessionOutboxItemDto) {
  return `outbox:${item.session_id}:${item.seq}`
}

function inboxEntryId(item: SessionInboxItemDto) {
  return `inbox:${item.seq}`
}

/** IDs each kind on the page refers to, gathered before one query per kind. */
function referencedIds(rows: readonly HistoryRow[], capture: CaptureSnapshotDto) {
  const ids = {
    observations: new Set<string>(),
    lots: new Set<string>(),
    proposalAttempts: new Set<string>(),
    questions: new Set<string>(),
    instructions: new Set<string>(),
  }
  const lots = new Map(capture.lots.map((lot) => [lot.id, lot]))
  for (const row of rows) {
    const { item } = row
    if (item.kind === 'observation') {
      ids.observations.add(item.payload.evidence_observation_id)
    } else if (item.kind === 'lot') {
      ids.lots.add(item.payload.lot_id)
      for (const id of lots.get(item.payload.lot_id)?.evidence_observation_ids ?? []) {
        ids.observations.add(id)
      }
    } else if (item.kind === 'regroup') {
      for (const move of item.payload.moves ?? []) {
        ids.observations.add(move.observation_id)
      }
    } else if (item.kind === 'proposal' && row.stream === 'outbox') {
      ids.proposalAttempts.add(row.item.session_id)
    } else if (item.kind === 'question') {
      ids.questions.add(item.payload.question_id)
    } else if (item.kind === 'answer') {
      ids.questions.add(item.payload.question_id)
    } else if (item.kind === 'instruction') {
      ids.instructions.add(item.payload.instruction_id)
    }
  }
  return ids
}

/** Observations by ID with their current values and active lot, removed versions included. */
async function observationsById(client: PoolClient, batchId: string, ids: Set<string>) {
  if (!ids.size) {
    return new Map<string, Omit<CurrentObservation, 'evidence_id'>>()
  }
  const rows = await client.query<{
    id: string
    evidence_version_id: string
    page: number
    region: EvidenceRegionDto
    readings: EvidenceReadingsDto
    visible_count: number | null
    status: 'active' | 'suggested'
    lot_id: string | null
  }>(
    `SELECT o.id, o.evidence_version_id, o.page, o.region, o.readings, o.visible_count, o.status,
            (SELECT m.lot_id FROM public.capture_lot_evidence_observation m
              WHERE m.evidence_observation_id=o.id AND m.status='active'
              ORDER BY m.lot_id LIMIT 1) AS lot_id
       FROM public.capture_evidence_observation o
      WHERE o.batch_id=$1 AND o.id = ANY($2::uuid[])`,
    [batchId, [...ids]],
  )
  return new Map(rows.rows.map((row) => [row.id, row]))
}

/** Every evidence version of the batch with its item's label and whether the item is removed. */
async function evidenceDirectory(client: PoolClient, batchId: string) {
  const rows = await client.query<{ version_id: string; evidence_id: string; label: string }>(
    `SELECT v.id AS version_id, v.evidence_id, e.label
       FROM public.media_version v JOIN public.media_evidence e ON e.id=v.evidence_id
      WHERE v.batch_id=$1`,
    [batchId],
  )
  const removed = await removedEvidenceIds(client, batchId)
  return new Map(
    rows.rows.map((row) => [
      row.version_id,
      { evidenceId: row.evidence_id, label: row.label, removed: removed.has(row.evidence_id) },
    ]),
  )
}

type EvidenceDirectory = Awaited<ReturnType<typeof evidenceDirectory>>

/** Each lot's first `lot` entry in the lineage, which formed it; later ones extended it. */
async function lotFormingEntries(client: PoolClient, jobId: string, lotIds: Set<string>) {
  if (!lotIds.size) {
    return new Map<string, string>()
  }
  const rows = await client.query<{ lot_id: string; session_id: string; seq: string }>(
    `SELECT DISTINCT ON (o.payload->>'lot_id') o.payload->>'lot_id' AS lot_id, o.session_id,
            o.seq::text
       FROM public.agent_session_outbox o
       JOIN public.agent_session s ON s.attempt_id=o.session_id
      WHERE s.session_lineage_id=$1 AND o.kind='lot' AND o.payload->>'lot_id' = ANY($2::text[])
      ORDER BY o.payload->>'lot_id', o.created_at, o.session_id, o.seq`,
    [jobId, [...lotIds]],
  )
  return new Map(rows.rows.map((row) => [row.lot_id, `outbox:${row.session_id}:${row.seq}`]))
}

interface RetainedProposal {
  id: string
  attemptId: string
  entryId: string
  value: SessionProposalDto
}

/**
 * Every proposal of the attempts that have one on the page, in outbox order, so a web read is
 * linked to the first proposal of its attempt that cites the page, even one on an older page.
 */
async function proposalsOfAttempts(
  client: PoolClient,
  context: HistoryContext,
  attemptIds: Set<string>,
) {
  const byId = new Map<string, RetainedProposal>()
  if (!attemptIds.size) {
    return byId
  }
  const rows = await client.query<{
    id: string
    message_id: string
    attempt_id: string
    job_id: string
    command_id: string
    seq: string
    manifest_bytes: Buffer
    manifest_digest: Buffer
    value_bytes: Buffer
    value_digest: Buffer
    envelope_bytes: Buffer
    envelope_digest: Buffer
    disposition: string
  }>(
    `SELECT p.id, p.message_id, p.attempt_id, a.job_id, a.command_id, o.seq::text,
            i.manifest_bytes, i.manifest_digest, p.value_bytes, p.value_digest,
            m.envelope_bytes, m.envelope_digest, m.disposition
       FROM public.processing_proposal p
       JOIN public.processing_attempt a ON a.id=p.attempt_id
       JOIN public.processing_input i ON i.id=a.input_id
       JOIN public.processing_message m ON m.id=p.message_id
       JOIN public.agent_session_outbox o
         ON o.session_id=p.attempt_id AND o.kind='proposal' AND o.payload->>'proposal_id'=p.id::text
      WHERE a.job_id=$1 AND p.attempt_id = ANY($2::uuid[])
      ORDER BY o.created_at, o.session_id, o.seq`,
    [context.job.id, [...attemptIds]],
  )
  const versions = await batchVersions(client, context.job.batchId)
  const lots = new Set(context.capture.lots.map((lot) => lot.id))
  const manifests = new Map<string, ProcessingInputV6Dto>()
  for (const row of rows.rows) {
    const manifest =
      manifests.get(row.attempt_id) ?? decodeSessionInput(row.manifest_bytes, row.manifest_digest)
    manifests.set(row.attempt_id, manifest)
    const value = retainedSessionProposal(
      {
        attemptId: row.attempt_id,
        jobId: row.job_id,
        commandId: row.command_id,
        manifestDigest: row.manifest_digest,
        envelopeBytes: row.envelope_bytes,
        envelopeDigest: row.envelope_digest,
        disposition: row.disposition,
        valueBytes: row.value_bytes,
        valueDigest: row.value_digest,
      },
      context.job.subjectId,
      manifest,
      lots,
      versions,
    )
    byId.set(row.id, {
      id: row.id,
      attemptId: row.attempt_id,
      entryId: `outbox:${row.attempt_id}:${row.seq}`,
      value,
    })
  }
  return byId
}

/** The batch's versions a session may have been delivered after opening, as the snapshot reads. */
async function batchVersions(client: PoolClient, batchId: string) {
  const rows = await client.query<{ versionId: string; evidenceId: string; digest: string }>(
    `SELECT id AS "versionId", evidence_id AS "evidenceId", encode(blob_digest,'hex') AS digest
       FROM public.media_version WHERE batch_id=$1`,
    [batchId],
  )
  return rows.rows
}

/** For each proposal, the web pages it is the first in its attempt to cite, by source index. */
function firstWebCitations(proposals: Map<string, RetainedProposal>) {
  const seen = new Set<string>()
  const first = new Map<string, number[]>()
  for (const proposal of proposals.values()) {
    const indexes: number[] = []
    proposal.value.sources.forEach((source, index) => {
      if (source.kind !== 'web_page') {
        return
      }
      const key = `${proposal.attemptId} ${source.url}`
      if (!seen.has(key)) {
        seen.add(key)
        indexes.push(index)
      }
    })
    first.set(proposal.id, indexes)
  }
  return first
}

interface RetainedQuestion {
  ask: SessionAsk
  state: 'open' | 'answered' | 'superseded'
  jobSubjectId: string | null
}

/**
 * Questions by ID, from any job of the batch: a proposal can be provisional on another
 * session's question, such as the lead session's question about its lot.
 */
async function questionsById(client: PoolClient, context: HistoryContext, ids: Set<string>) {
  const byId = new Map<string, RetainedQuestion>()
  if (!ids.size) {
    return byId
  }
  const rows = await client.query<{
    id: string
    attempt_id: string
    job_id: string
    job_subject_id: string | null
    job_current_attempt_id: string
    command_id: string
    state: string
    manifest_digest: Buffer
    spec_bytes: Buffer
    spec_digest: Buffer
    envelope_bytes: Buffer
    envelope_digest: Buffer
    disposition: string
  }>(
    `SELECT q.id, q.attempt_id, q.job_id, j.subject_id AS job_subject_id,
            j.current_attempt_id AS job_current_attempt_id, a.command_id, q.state,
            i.manifest_digest, q.spec_bytes, q.spec_digest, m.envelope_bytes, m.envelope_digest,
            m.disposition
       FROM public.processing_question q
       JOIN public.processing_job j ON j.id=q.job_id
       JOIN public.processing_attempt a ON a.id=q.attempt_id
       JOIN public.processing_input i ON i.id=q.input_id
       JOIN public.processing_message m ON m.id=q.message_id
      WHERE q.batch_id=$1 AND j.batch_id=$1 AND q.id = ANY($2::uuid[])`,
    [context.job.batchId, [...ids]],
  )
  const subjects = new Set([
    ...context.capture.lots.map((lot) => lot.id),
    ...context.capture.parts.map((part) => part.id),
  ])
  for (const row of rows.rows) {
    const ask = retainedSessionQuestion(
      {
        attemptId: row.attempt_id,
        jobId: row.job_id,
        commandId: row.command_id,
        manifestDigest: row.manifest_digest,
        envelopeBytes: row.envelope_bytes,
        envelopeDigest: row.envelope_digest,
        disposition: row.disposition,
        specBytes: row.spec_bytes,
        specDigest: row.spec_digest,
      },
      row.job_subject_id,
      subjects,
    )
    // An open question of an earlier attempt can no longer be answered.
    const superseded = row.state === 'open' && row.attempt_id !== row.job_current_attempt_id
    const state = superseded ? 'superseded' : (row.state as RetainedQuestion['state'])
    byId.set(row.id, { ask, state, jobSubjectId: row.job_subject_id })
  }
  return byId
}

/** When each instruction version was saved. */
async function instructionsSavedAt(client: PoolClient, batchId: string, ids: Set<string>) {
  if (!ids.size) {
    return new Map<string, string>()
  }
  const rows = await client.query<{ id: string; created_at: Date }>(
    'SELECT id, created_at FROM public.capture_instruction WHERE batch_id=$1 AND id = ANY($2::uuid[])',
    [batchId, [...ids]],
  )
  return new Map(rows.rows.map((row) => [row.id, row.created_at.toISOString()]))
}

function askTitle(ask: SessionAsk) {
  return 'steps' in ask ? questionView(ask).title : ask.prompt
}

/** What the question is about: its subject, or its job's lot when it names none. */
function questionSubject(question: RetainedQuestion) {
  return question.ask.subject_id ?? question.jobSubjectId
}

/** The resolved records a page's entries are built from, read once per kind. */
interface Resolved {
  context: HistoryContext
  lots: Map<string, CaptureSnapshotDto['lots'][number]>
  parts: Map<string, CaptureSnapshotDto['parts'][number]>
  observations: Awaited<ReturnType<typeof observationsById>>
  evidence: EvidenceDirectory
  lotForming: Map<string, string>
  proposals: Map<string, RetainedProposal>
  webCitations: Map<string, number[]>
  currentness: Awaited<ReturnType<typeof proposalCurrentnessFacts>>
  questions: Map<string, RetainedQuestion>
  instructions: Map<string, string>
}

function lotLink(resolved: Resolved, lotId: string): SessionHistoryLinkDto {
  const lot = resolved.lots.get(lotId)
  if (!lot) {
    return { kind: 'gone', target: 'lot', label: 'Lot no longer exists' }
  }
  if (lot.retired) {
    return { kind: 'gone', target: 'lot', label: 'Lot retired' }
  }
  return { kind: 'lot', lot_id: lot.id, label: oneLine(lot.label, LABEL_MAX_CHARACTERS) }
}

/** The lot's Review link and its place on the map, or one gone link. */
function lotLinks(resolved: Resolved, lotId: string): SessionHistoryLinkDto[] {
  const link = lotLink(resolved, lotId)
  return link.kind === 'lot' ? [link, { kind: 'map', lot_id: lotId }] : [link]
}

function evidenceLink(resolved: Resolved, versionId: string, page: number): SessionHistoryLinkDto {
  const found = resolved.evidence.get(versionId)
  if (!found) {
    return { kind: 'gone', target: 'evidence', label: 'Photo no longer exists' }
  }
  if (found.removed) {
    return { kind: 'gone', target: 'evidence', label: 'Photo removed' }
  }
  return {
    kind: 'capture_evidence',
    evidence_id: found.evidenceId,
    version_id: versionId,
    page,
    label: oneLine(found.label, LABEL_MAX_CHARACTERS),
  }
}

function evidenceLabel(resolved: Resolved, versionId: string) {
  return resolved.evidence.get(versionId)?.label ?? 'a photo'
}

function questionLink(resolved: Resolved, questionId: string): SessionHistoryLinkDto {
  const question = resolved.questions.get(questionId)
  if (!question) {
    return { kind: 'gone', target: 'question', label: 'Question no longer exists' }
  }
  return {
    kind: 'question',
    question_id: questionId,
    label: oneLine(askTitle(question.ask), LABEL_MAX_CHARACTERS),
  }
}

function currentObservation(resolved: Resolved, id: string): CurrentObservation | null {
  const row = resolved.observations.get(id)
  if (!row) {
    return null
  }
  const evidence = resolved.evidence.get(row.evidence_version_id)
  if (!evidence) {
    return null
  }
  return { ...row, evidence_id: evidence.evidenceId }
}

type Built = Pick<SessionHistoryEntryDto, 'summary' | 'links' | 'details'>

function observationEntry(resolved: Resolved, item: OutboxOf<'observation'>): Built {
  const current = currentObservation(resolved, item.payload.evidence_observation_id)
  const links: SessionHistoryLinkDto[] = current
    ? [
        evidenceLink(resolved, current.evidence_version_id, current.page),
        { kind: 'map', observation_id: current.id },
      ]
    : [{ kind: 'gone', target: 'observation', label: 'Observation no longer exists' }]
  const where = current ? ` in ${evidenceLabel(resolved, current.evidence_version_id)}` : ''
  return {
    summary: oneLine(`Recorded an observation${where}`),
    links,
    details: { kind: 'observation', current },
  }
}

function lotEntry(resolved: Resolved, entryId: string, item: OutboxOf<'lot'>): Built {
  const lot = resolved.lots.get(item.payload.lot_id)
  const formed = resolved.lotForming.get(item.payload.lot_id) === entryId
  const observations = (lot?.evidence_observation_ids ?? []).flatMap((id) => {
    const current = currentObservation(resolved, id)
    return current ? [current] : []
  })
  const estimate =
    lot?.estimated_quantity && lot.quantity_basis
      ? { quantity: lot.estimated_quantity, basis: lot.quantity_basis }
      : null
  const label = lot ? lot.label : 'a lot'
  return {
    summary: oneLine(`${formed ? 'Formed' : 'Updated'} ${label}`),
    links: lotLinks(resolved, item.payload.lot_id),
    details: {
      kind: 'lot',
      lot: lot
        ? {
            id: lot.id,
            label: oneLine(lot.label, LABEL_MAX_CHARACTERS),
            retired: lot.retired === true,
            operator_edited: lot.operator_edited === true,
            observations,
            selected_quantity: lot.quantity,
            estimate,
            part_subject_id: lot.part_subject_id,
          }
        : null,
      current: true,
      formed,
      // propose_lot records no reason for keeping a lot separate.
      not_retained: ['separation_reason'],
    },
  }
}

function regroupEntry(resolved: Resolved, item: OutboxOf<'regroup'>): Built {
  const { moves, lot_ids: lotIds } = item.payload
  const affected = moves
    ? [...new Set(moves.flatMap((move) => [move.from_lot_id, move.to_lot_id]))].filter(
        (id): id is string => id !== null,
      )
    : lotIds
  const links = affected.map((id) => lotLink(resolved, id))
  let summary: string
  if (moves) {
    const suggested = moves.filter((move) => move.outcome === 'suggested').length
    const noun = moves.length === 1 ? 'observation' : 'observations'
    summary = `Moved ${moves.length} ${noun}`
    if (suggested) {
      summary += `, ${suggested} only suggested`
    }
  } else {
    const labels = lotIds.map((id) => resolved.lots.get(id)?.label ?? 'a lot')
    summary = `Regrouped observations into ${labels.join(', ')}`
  }
  return {
    summary: oneLine(summary),
    links,
    details: { kind: 'regroup', lot_ids: lotIds, ...(moves ? { moves } : {}) },
  }
}

function proposalCurrentnessOf(resolved: Resolved, proposalId: string): Currentness {
  const facts = resolved.currentness.get(proposalId)
  if (facts?.stale) {
    return { state: 'stale', reason: facts.stale }
  }
  if (facts?.provisionalQuestionIds.length) {
    return { state: 'provisional', question_ids: facts.provisionalQuestionIds }
  }
  return { state: 'current' }
}

function sourceLinks(resolved: Resolved, proposal: SessionProposalDto): SessionHistoryLinkDto[] {
  return proposal.sources.flatMap((source): SessionHistoryLinkDto[] => {
    if (source.kind === 'media_version') {
      return [evidenceLink(resolved, source.version_id, 1)]
    }
    if (source.kind === 'web_page') {
      return [
        {
          kind: 'external_url',
          url: source.url,
          label: oneLine(source.title ?? new URL(source.url).hostname, LABEL_MAX_CHARACTERS),
        },
      ]
    }
    return []
  })
}

function proposalEntry(resolved: Resolved, item: OutboxOf<'proposal'>): Built {
  const proposal =
    resolved.proposals.get(item.payload.proposal_id) ?? fail('retained_proposal_binding_invalid')
  const currentness = proposalCurrentnessOf(resolved, proposal.id)
  const lot = resolved.lots.get(proposal.value.subject_id)
  const questions =
    currentness.state === 'provisional'
      ? currentness.question_ids.map((id) => questionLink(resolved, id))
      : []
  // A Part to link only where the structured catalogue block was retained.
  const record: SessionHistoryLinkDto[] =
    proposal.value.catalogue && lot?.part_subject_id
      ? [partLink(resolved, lot.part_subject_id)]
      : []
  const suffix = currentness.state === 'current' ? '' : ` · ${currentness.state}`
  return {
    summary:
      oneLine(`Proposed ${proposal.value.summary}`, SUMMARY_MAX_CHARACTERS - suffix.length) +
      suffix,
    links: [
      ...lotLinks(resolved, proposal.value.subject_id),
      ...record,
      ...sourceLinks(resolved, proposal.value),
      ...questions,
    ],
    details: { kind: 'proposal', proposal_id: proposal.id, proposal: proposal.value, currentness },
  }
}

function partLink(resolved: Resolved, partId: string): SessionHistoryLinkDto {
  const part = resolved.parts.get(partId)
  return {
    kind: 'record',
    part_subject_id: partId,
    label: oneLine(part?.label ?? 'Part', LABEL_MAX_CHARACTERS),
  }
}

/** Web pages the proposal is the first in its attempt to cite, placed with it. */
function webReadEntries(
  resolved: Resolved,
  proposalEntry: SessionHistoryEntryDto,
  item: OutboxOf<'proposal'>,
): SessionHistoryEntryDto[] {
  const proposal = resolved.proposals.get(item.payload.proposal_id)
  if (!proposal) {
    return []
  }
  return (resolved.webCitations.get(proposal.id) ?? []).flatMap((index) => {
    const source = proposal.value.sources[index]
    if (source?.kind !== 'web_page') {
      return []
    }
    const name = source.title ?? new URL(source.url).hostname
    return [
      {
        ...proposalEntry,
        id: `${proposalEntry.id}:web:${index}`,
        summary: oneLine(`Read ${name}`),
        links: [
          {
            kind: 'external_url',
            url: source.url,
            label: oneLine(name, LABEL_MAX_CHARACTERS),
          },
        ],
        details: {
          kind: 'web_read',
          url: source.url,
          ...(source.title ? { title: source.title } : {}),
          ...(source.read_at ? { read_at: source.read_at } : {}),
          proposal_entry_id: proposalEntry.id,
        },
      } as SessionHistoryEntryDto,
    ]
  })
}

function questionEntry(resolved: Resolved, item: OutboxOf<'question'>): Built {
  const question =
    resolved.questions.get(item.payload.question_id) ?? fail('retained_question_binding_invalid')
  const subject = questionSubject(question)
  const lot = subject && resolved.lots.has(subject) ? lotLinks(resolved, subject) : []
  return {
    summary: oneLine(`Asked: ${askTitle(question.ask)}`),
    links: [questionLink(resolved, item.payload.question_id), ...lot],
    details: {
      kind: 'question',
      question_id: item.payload.question_id,
      question: question.ask,
      state: question.state,
    },
  }
}

function photoViewEntry(resolved: Resolved, item: OutboxOf<'photo_view'>): Built {
  const view = item.payload
  const found = resolved.evidence.get(view.version_id)
  const where = evidenceLabel(resolved, view.version_id)
  const page = view.page > 1 ? `, page ${view.page}` : ''
  return {
    summary: oneLine(`${view.region ? 'Viewed part of' : 'Viewed'} ${where}${page}`),
    links: [evidenceLink(resolved, view.version_id, view.page)],
    details: {
      kind: 'photo_view',
      view,
      // A removed version can no longer be recut.
      crop: found && !found.removed ? { attempt_id: item.session_id, seq: item.seq } : null,
    },
  }
}

/** What the answer changed: a number sets the lot's quantity, other steps add one note. */
function answerEffects(
  payload: SessionAnswerPayloadDto,
  subjectId: string | null,
): Extract<SessionHistoryDetailsDto, { kind: 'answer' }>['effects'] {
  const values = 'value' in payload ? [payload.value] : payload.steps.map((step) => step.value)
  const effects: Extract<SessionHistoryDetailsDto, { kind: 'answer' }>['effects'] = []
  const number = values.find((value) => value.kind === 'quantity' || value.kind === 'number')
  if (number && subjectId && (number.kind === 'quantity' || number.kind === 'number')) {
    effects.push({ kind: 'quantity', lot_id: subjectId, value: number.value, basis: number.basis })
  }
  if (values.some((value) => value.kind !== 'quantity' && value.kind !== 'number')) {
    effects.push({ kind: 'note', subject_id: subjectId })
  }
  return effects
}

function answerValueText(
  value:
    | Extract<SessionAnswerPayloadDto, { value: unknown }>['value']
    | Extract<SessionAnswerPayloadDto, { steps: unknown }>['steps'][number]['value'],
) {
  if (value.kind === 'quantity' || value.kind === 'number') {
    return `${value.value} ${value.basis}`
  }
  if (value.kind === 'clarification' || value.kind === 'text') {
    return value.text
  }
  return 'label' in value ? value.label : value.other
}

function answerEntry(resolved: Resolved, item: InboxOf<'answer'>): Built {
  const payload = item.payload
  const question = resolved.questions.get(payload.question_id)
  const subject = question ? questionSubject(question) : null
  const values = 'value' in payload ? [payload.value] : payload.steps.map((step) => step.value)
  const lot = subject && resolved.lots.has(subject) ? lotLinks(resolved, subject) : []
  return {
    summary: oneLine(`You answered: ${values.map(answerValueText).join(' · ')}`),
    links: [questionLink(resolved, payload.question_id), ...lot],
    details: { kind: 'answer', answer: payload, effects: answerEffects(payload, subject) },
  }
}

function instructionEntry(
  resolved: Resolved,
  item: InboxOf<'instruction'>,
  idempotencyKey: string,
): Built {
  // A copy keyed by an attempt was sent again to that attempt after a Start fresh or restart.
  const relayed = idempotencyKey !== `instruction:${item.payload.instruction_id}`
  const text = item.payload.text.trim()
  let summary = text ? `Instruction: ${text}` : 'Instruction cleared'
  if (relayed) {
    summary = text ? `Instruction relayed: ${text}` : 'Instruction cleared, relayed'
  }
  return {
    summary: oneLine(summary),
    links: [],
    details: {
      kind: 'instruction',
      instruction_id: item.payload.instruction_id,
      text: item.payload.text,
      group_id: item.payload.group_id,
      saved_at: resolved.instructions.get(item.payload.instruction_id) ?? null,
      relayed,
    },
  }
}

function evidenceEntry(
  resolved: Resolved,
  item: InboxOf<'evidence'>,
  idempotencyKey: string,
): Built {
  const restored = idempotencyKey.startsWith('restored:')
  const label = evidenceLabel(resolved, item.payload.version_id)
  return {
    summary: oneLine(`${restored ? 'Photo restored' : 'New photo'}: ${label}`),
    links: [evidenceLink(resolved, item.payload.version_id, 1)],
    details: {
      kind: 'evidence',
      evidence_id: item.payload.evidence_id,
      version_id: item.payload.version_id,
      restored,
    },
  }
}

function outboxEntry(resolved: Resolved, entryId: string, item: SessionOutboxItemDto): Built {
  switch (item.kind) {
    case 'status':
      return {
        summary: oneLine(item.payload.text),
        links: [],
        details: { kind: 'status', text: item.payload.text },
      }
    case 'observation':
      return observationEntry(resolved, item)
    case 'lot':
      return lotEntry(resolved, entryId, item)
    case 'regroup':
      return regroupEntry(resolved, item)
    case 'proposal':
      return proposalEntry(resolved, item)
    case 'question':
      return questionEntry(resolved, item)
    case 'reply':
      return {
        summary: oneLine(`Replied: ${item.payload.text}`),
        links: [],
        details: {
          kind: 'reply',
          inbox_item_id: item.payload.inbox_item_id,
          text: item.payload.text,
        },
      }
    case 'photo_view':
      return photoViewEntry(resolved, item)
  }
}

function inboxEntry(
  resolved: Resolved,
  row: Extract<HistoryRow, { stream: 'inbox' }>,
): Built & Pick<Extract<SessionHistoryEntryDto, { who: 'operator' | 'app' }>, 'who'> {
  const { item } = row
  switch (item.kind) {
    case 'answer':
      return { who: 'operator', ...answerEntry(resolved, item) }
    case 'chat':
      return {
        who: 'operator',
        summary: oneLine(item.payload.text),
        links: [],
        details: { kind: 'chat', text: item.payload.text },
      }
    case 'instruction':
      return { who: 'operator', ...instructionEntry(resolved, item, row.idempotencyKey) }
    case 'evidence':
      return { who: 'app', ...evidenceEntry(resolved, item, row.idempotencyKey) }
    case 'revision':
      return {
        who: 'app',
        summary: oneLine(`Revision: ${item.payload.reason}`),
        links: [],
        details: { kind: 'revision', fields: item.payload.fields, reason: item.payload.reason },
      }
  }
}

/**
 * Resolves a page's rows into entries with one query per kind, from the read's snapshot. Values
 * a record holds now are labelled current, and a retired or removed target becomes a gone link.
 */
export async function resolveHistoryEntries(
  client: PoolClient,
  context: HistoryContext,
  rows: readonly HistoryRow[],
): Promise<SessionHistoryEntryDto[]> {
  const ids = referencedIds(rows, context.capture)
  const proposals = await proposalsOfAttempts(client, context, ids.proposalAttempts)
  const resolved: Resolved = {
    context,
    lots: new Map(context.capture.lots.map((lot) => [lot.id, lot])),
    parts: new Map(context.capture.parts.map((part) => [part.id, part])),
    observations: await observationsById(client, context.job.batchId, ids.observations),
    evidence: await evidenceDirectory(client, context.job.batchId),
    lotForming: await lotFormingEntries(client, context.job.id, ids.lots),
    proposals,
    webCitations: firstWebCitations(proposals),
    currentness: proposals.size
      ? await proposalCurrentnessFacts(client, context.job.batchId, [...proposals.keys()])
      : new Map(),
    questions: new Map(),
    instructions: await instructionsSavedAt(client, context.job.batchId, ids.instructions),
  }
  for (const [, fact] of resolved.currentness) {
    for (const questionId of fact.provisionalQuestionIds) {
      ids.questions.add(questionId)
    }
  }
  resolved.questions = await questionsById(client, context, ids.questions)

  const entries: SessionHistoryEntryDto[] = []
  for (const row of rows) {
    if (row.stream === 'outbox') {
      const id = outboxEntryId(row.item)
      const entry: SessionHistoryEntryDto = {
        id,
        at: row.item.created_at,
        who: 'agent',
        attempt: row.attemptNumber,
        ...outboxEntry(resolved, id, row.item),
      }
      entries.push(entry)
      if (row.item.kind === 'proposal') {
        entries.push(...webReadEntries(resolved, entry, row.item))
      }
      continue
    }
    entries.push({
      id: inboxEntryId(row.item),
      at: row.item.created_at,
      read: BigInt(row.item.seq) <= context.ackedSeq,
      ...inboxEntry(resolved, row),
    })
  }
  return entries
}
