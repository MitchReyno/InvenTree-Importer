import type { FastifyRequest } from 'fastify'
import { Id } from '@invimport/contracts'
import { fail } from '#/capture/model.ts'

const ID_PATTERN = new RegExp(Id.pattern!)

export function pathId(request: FastifyRequest) {
  const id = (request.params as { id: string }).id
  if (!ID_PATTERN.test(id)) {
    fail('invalid_id', 400)
  }
  return id
}

export function commandKey(request: FastifyRequest) {
  const key = request.headers['idempotency-key']
  if (typeof key !== 'string' || !ID_PATTERN.test(key)) {
    fail('idempotency_key_required', 400)
  }
  return key
}
