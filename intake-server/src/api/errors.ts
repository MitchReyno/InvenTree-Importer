import type { FastifyReply, FastifyRequest } from 'fastify'
import { CaptureError } from '../capture/model.ts'
import { ProcessingError } from '../processing/model.ts'

/** Read models publish a known domain error and leave every other failure to the server handler. */
export function readModelError(message: string) {
  return (error: unknown, request: FastifyRequest, reply: FastifyReply) => {
    if (!(error instanceof CaptureError) && !(error instanceof ProcessingError)) {
      throw error
    }
    reply.code(error.statusCode).send({
      code: error.code,
      message,
      recovery: 'none',
      correlation_id: request.id,
    })
  }
}
