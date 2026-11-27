import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Pool } from 'pg'
import {
  Id,
  schemas,
  type MatchAnswerDto,
  type MatchBatchAnswerDto,
  type MatchCheckDto,
} from '@invimport/contracts'
import { commandKey } from '#/api/request.ts'
import type { ProcessingConfig } from '#/processing/attempts.ts'
import { fail } from '#/processing/model.ts'
import { answerMatchBatch, answerMatchQuestion } from './answers.ts'
import { checkMatches, reopenMatch } from './commands.ts'
import { readBatchMatch } from './read.ts'

function id(request: FastifyRequest, field: string) {
  const value = (request.params as Record<string, string>)[field]
  if (!value || !new RegExp(Id.pattern!).test(value)) {
    fail('invalid_id', 400)
  }
  return value
}

/** The Match step's read and its operator commands, inside Processing's route scope. */
export function registerMatchRoutes(scope: FastifyInstance, pool: Pool, config: ProcessingConfig) {
  scope.get(
    '/api/v1/batches/:id/match',
    { schema: { response: { 200: schemas.BatchMatch } } },
    (request) => readBatchMatch(pool, config, id(request, 'id')),
  )
  scope.post<{ Body: MatchAnswerDto }>(
    '/api/v1/batches/:id/match/questions/:questionId/answers',
    { schema: { body: schemas.MatchAnswer, response: { 200: schemas.MatchAnswerReceipt } } },
    (request) =>
      answerMatchQuestion(
        pool,
        config,
        id(request, 'id'),
        id(request, 'questionId'),
        commandKey(request),
        request.body,
      ),
  )
  scope.post<{ Body: MatchBatchAnswerDto }>(
    '/api/v1/batches/:id/match/answers',
    { schema: { body: schemas.MatchBatchAnswer, response: { 200: schemas.MatchAnswerReceipt } } },
    (request) =>
      answerMatchBatch(pool, config, id(request, 'id'), commandKey(request), request.body),
  )
  scope.post<{ Body: MatchCheckDto }>(
    '/api/v1/batches/:id/match/checks',
    { schema: { body: schemas.MatchCheck, response: { 202: schemas.MatchCheckReceipt } } },
    async (request, reply) =>
      reply
        .code(202)
        .send(
          await checkMatches(pool, config, id(request, 'id'), commandKey(request), request.body),
        ),
  )
  scope.post(
    '/api/v1/batches/:id/match/lots/:lotId/question',
    { schema: { body: schemas.MatchReopen, response: { 200: schemas.MatchCheckReceipt } } },
    (request) =>
      reopenMatch(pool, config, id(request, 'id'), id(request, 'lotId'), commandKey(request)),
  )
}
