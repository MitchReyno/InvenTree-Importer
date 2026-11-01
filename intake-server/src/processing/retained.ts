import type { PoolClient } from 'pg'
import {
  validate,
  type ProcessingEnvelopeDto,
  type ProcessingQuestionSpecDto,
  type ProcessingProposalDto,
} from '@invimport/contracts'
import { canonical } from '@invimport/contracts/json'
import { decodeProposal, decodeQuestionSpec, fail, unseal } from './model.ts'

interface MessageSeal {
  attempt_id: string
  job_id: string
  command_id: string
  manifest_digest: Buffer
  envelope_bytes: Buffer
  envelope_digest: Buffer
  disposition: string
}

function acceptedProducer(seal: MessageSeal): ProcessingEnvelopeDto {
  const value = unseal(seal.envelope_bytes, seal.envelope_digest)
  validate('ProcessingEnvelope', value)
  // Runtime validation above establishes this union; the following checks establish its authority.
  const envelope = value as ProcessingEnvelopeDto
  const parentMatches =
    envelope.attempt_id === seal.attempt_id &&
    envelope.job_id === seal.job_id &&
    envelope.command_id === seal.command_id &&
    envelope.input_sha256 === seal.manifest_digest.toString('hex')
  if (!parentMatches || seal.disposition !== 'accepted') {
    fail('retained_message_binding_invalid')
  }

  return envelope
}

export function retainedQuestionSpec(
  seal: MessageSeal & { spec_bytes: Buffer; spec_digest: Buffer },
  subjectId: string,
): ProcessingQuestionSpecDto {
  const envelope = acceptedProducer(seal)
  const spec = decodeQuestionSpec(seal.spec_bytes, seal.spec_digest)
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
  seal: MessageSeal & { value_bytes: Buffer; value_digest: Buffer },
  subjectId: string,
): ProcessingProposalDto {
  const envelope = acceptedProducer(seal)
  const proposal = decodeProposal(seal.value_bytes, seal.value_digest)
  const completePayloadMatches =
    envelope.kind === 'proposal' &&
    canonical(envelope.payload) === canonical(proposal) &&
    proposal.subject_id === subjectId
  if (!completePayloadMatches) {
    fail('retained_proposal_binding_invalid')
  }

  return proposal
}

export async function loadRetainedQuestionSpec(
  client: PoolClient,
  questionId: string,
  subjectId: string,
) {
  const questions = await client.query(
    `SELECT question.*,attempt.command_id,input.manifest_digest,
       message.envelope_bytes,message.envelope_digest,message.disposition
     FROM processing_question question
     JOIN processing_attempt attempt ON attempt.id=question.attempt_id
     JOIN processing_input input ON input.id=question.input_id
     JOIN processing_message message ON message.id=question.message_id
     WHERE question.id=$1`,
    [questionId],
  )
  const question = questions.rows[0] ?? fail('question_not_found', 404)
  return retainedQuestionSpec(question, subjectId)
}
