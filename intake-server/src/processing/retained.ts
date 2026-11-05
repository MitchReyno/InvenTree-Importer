import { eq, getTableColumns } from 'drizzle-orm'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import {
  processingQuestions,
  processingAttempts,
  processingInputs,
  processingMessages,
} from './schema.ts'
import type { PoolClient } from 'pg'
import {
  validate,
  type ProcessingInputV6Dto,
  type ProcessingProposalV5Dto,
  type SessionAskArgsDto,
  type SessionEnvelopeDto,
  type ProcessingEnvelopeDto,
  type ProcessingQuestionSpecDto,
  type ProcessingProposalDto,
  type ProcessingInputDto,
} from '@invimport/contracts'
import { catalogueSources, deliveredSourceCheck, validateProposalSources } from './provenance.ts'
import { canonical } from '@invimport/contracts/json'
import { decodeProposal, decodeQuestionSpec, fail, unseal } from './model.ts'

interface MessageSeal {
  attemptId: string
  jobId: string
  commandId: string
  manifestDigest: Buffer
  envelopeBytes: Buffer
  envelopeDigest: Buffer
  disposition: string
}

function acceptedProducer(seal: MessageSeal): ProcessingEnvelopeDto {
  const value = unseal(seal.envelopeBytes, seal.envelopeDigest)
  validate('ProcessingEnvelope', value)
  // Runtime validation above establishes this union; the following checks establish its authority.
  const envelope = value as ProcessingEnvelopeDto
  const parentMatches =
    envelope.attempt_id === seal.attemptId &&
    envelope.job_id === seal.jobId &&
    envelope.command_id === seal.commandId &&
    envelope.input_sha256 === seal.manifestDigest.toString('hex')
  if (!parentMatches || seal.disposition !== 'accepted') {
    fail('retained_message_binding_invalid')
  }

  return envelope
}

export function retainedQuestionSpec(
  seal: MessageSeal & { specBytes: Buffer; specDigest: Buffer },
  subjectId: string,
): ProcessingQuestionSpecDto {
  const envelope = acceptedProducer(seal)
  const spec = decodeQuestionSpec(seal.specBytes, seal.specDigest)
  const completePayloadMatches =
    envelope.kind === 'question' &&
    canonical(envelope.payload) === canonical(spec) &&
    spec.subject_id === subjectId
  if (!completePayloadMatches) {
    fail('retained_question_binding_invalid')
  }

  return spec
}

export function retainedProposalValue(
  seal: MessageSeal & { valueBytes: Buffer; valueDigest: Buffer },
  subjectId: string,
  manifest: ProcessingInputDto,
): ProcessingProposalDto {
  const envelope = acceptedProducer(seal)
  const proposal = decodeProposal(seal.valueBytes, seal.valueDigest)
  const completePayloadMatches =
    envelope.kind === 'proposal' &&
    canonical(envelope.payload) === canonical(proposal) &&
    proposal.subject_id === subjectId
  if (!completePayloadMatches) {
    fail('retained_proposal_binding_invalid')
  }

  validateProposalSources(manifest, proposal)
  return proposal
}

export async function loadRetainedQuestionSpec(
  client: PoolClient,
  questionId: string,
  subjectId: string,
) {
  const questions = await executeDatabaseQuery(
    queryDatabase(client)
      .select({
        ...getTableColumns(processingQuestions),
        commandId: processingAttempts.commandId,
        manifestDigest: processingInputs.manifestDigest,
        envelopeBytes: processingMessages.envelopeBytes,
        envelopeDigest: processingMessages.envelopeDigest,
        disposition: processingMessages.disposition,
      })
      .from(processingQuestions)
      .innerJoin(processingAttempts, eq(processingAttempts.id, processingQuestions.attemptId))
      .innerJoin(processingInputs, eq(processingInputs.id, processingQuestions.inputId))
      .innerJoin(processingMessages, eq(processingMessages.id, processingQuestions.messageId))
      .where(eq(processingQuestions.id, questionId)),
  )
  const question = questions[0] ?? fail('question_not_found', 404)
  return retainedQuestionSpec(question, subjectId)
}

/** A session message's bytes, bound to its job, attempt, command and opening manifest. */
function acceptedSessionMessage(seal: MessageSeal): SessionEnvelopeDto {
  const value = unseal(seal.envelopeBytes, seal.envelopeDigest)
  validate('SessionEnvelope', value)
  const envelope = value as SessionEnvelopeDto
  const parentMatches =
    envelope.attempt_id === seal.attemptId &&
    envelope.job_id === seal.jobId &&
    envelope.command_id === seal.commandId &&
    envelope.input_sha256 === seal.manifestDigest.toString('hex')
  if (!parentMatches || seal.disposition !== 'accepted') {
    fail('retained_message_binding_invalid')
  }
  return envelope
}

/** A job may hold earlier-profile and session attempts; each message's own bytes decide. */
export function isSessionMessage(seal: Pick<MessageSeal, 'envelopeBytes' | 'envelopeDigest'>) {
  const value = unseal(seal.envelopeBytes, seal.envelopeDigest) as { schema_version?: unknown }
  return value.schema_version === 'bench-intake-session/1'
}

export function retainedSessionProposal(
  seal: MessageSeal & { valueBytes: Buffer; valueDigest: Buffer },
  subjectId: string | null,
  manifest: ProcessingInputV6Dto,
): ProcessingProposalV5Dto {
  const envelope = acceptedSessionMessage(seal)
  const value = unseal(seal.valueBytes, seal.valueDigest)
  validate('ProcessingProposalV5', value)
  const proposal = value as ProcessingProposalV5Dto
  if (
    envelope.kind !== 'proposal' ||
    canonical(envelope.payload) !== canonical(proposal) ||
    proposal.subject_id !== subjectId
  ) {
    fail('retained_proposal_binding_invalid')
  }
  const delivered = deliveredSourceCheck({
    batchId: manifest.batch_id,
    notes: manifest.notes,
    media: manifest.media,
  })
  if (![...proposal.sources, ...catalogueSources(proposal)].every(delivered)) {
    fail('retained_proposal_binding_invalid')
  }
  return proposal
}

export function retainedSessionQuestion(
  seal: MessageSeal & { specBytes: Buffer; specDigest: Buffer },
  subjectId: string | null,
): SessionAskArgsDto {
  const envelope = acceptedSessionMessage(seal)
  const value = unseal(seal.specBytes, seal.specDigest)
  validate('SessionAskArgs', value)
  const ask = value as SessionAskArgsDto
  if (
    envelope.kind !== 'question' ||
    canonical(envelope.payload) !== canonical(ask) ||
    ask.subject_id !== subjectId
  ) {
    fail('retained_question_binding_invalid')
  }
  return ask
}
