import Fastify, { type FastifyInstance } from 'fastify'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { schemas, validate } from '@invimport/contracts'
import { strictJson } from '@invimport/contracts/json'
import { bootstrap, type DevConfig } from '../config.ts'

/** Shared production parser/validator/serializer; fixture routes exercise this exact installation. */
export function installContracts(app: FastifyInstance) {
  app.removeContentTypeParser('application/json')
  app.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: 262144 }, (_req, body, done) => {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(body as Buffer)
      done(null, strictJson(text))
    } catch { done(Object.assign(new Error('invalid_json'), { statusCode: 400 }), undefined) }
  })
  app.setValidatorCompiler(({ schema }) => {
    const name = Object.entries(schemas).find(([, value]) => JSON.stringify(value) === JSON.stringify(schema))?.[0] as keyof typeof schemas | undefined
    if (!name) throw new Error('unregistered_contract')
    return value => {
      try { validate(name, value); return { value } }
      catch { return { error: new Error('invalid_contract') } }
    }
  })
  // Validate complete outputs rather than silently stripping accidental private fields.
  app.setSerializerCompiler(({ schema }) => {
    const name = Object.entries(schemas).find(([, value]) => JSON.stringify(value) === JSON.stringify(schema))?.[0] as keyof typeof schemas | undefined
    if (!name) throw new Error('unregistered_contract')
    return value => { validate(name, value); return JSON.stringify(value) }
  })
}

/** No DB connections, workers or target requests are started by constructing the web API. */
export function createServer(config: DevConfig) {
  const app = Fastify({ logger: false, bodyLimit: 262144, requestTimeout: 10000, connectionTimeout: 10000, routerOptions: { maxParamLength: 128 } })
  const csrfToken = randomBytes(32).toString('hex')
  const configured = bootstrap(config).status === 'configured'
  installContracts(app)
  app.addHook('onRequest', async (req, reply) => {
    reply.header('cache-control', 'no-store').header('x-content-type-options', 'nosniff')
    if (req.headers.host !== new URL(config.origin).host || (req.headers.origin && req.headers.origin !== config.origin)) {
      return reply.code(403).send({ code: 'access_denied', message: 'Origin or Host refused.', recovery: 'none', correlation_id: req.id })
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const token = req.headers['x-intake-csrf']
      if (!configured || req.headers.origin !== config.origin || typeof token !== 'string' || token.length !== 64 || !/^[0-9a-f]{64}$/.test(token) || !timingSafeEqual(Buffer.from(token), Buffer.from(csrfToken))) {
        return reply.code(403).send({ code: 'access_denied', message: 'Development command authorization refused.', recovery: 'none', correlation_id: req.id })
      }
    }
  })
  app.setErrorHandler((error, req, reply) => {
    const candidate = error instanceof Error && 'statusCode' in error ? error.statusCode : 500
    const status = typeof candidate === 'number' && candidate >= 400 && candidate < 500 ? candidate : 500
    reply.code(status).send({ code: status === 500 ? 'internal_error' : 'invalid_request', message: status === 500 ? 'Request could not be completed.' : 'Request was rejected.', recovery: 'none', correlation_id: req.id })
  })
  app.setNotFoundHandler((req, reply) => reply.code(404).send({ code: 'not_found', message: 'Route not found.', recovery: 'none', correlation_id: req.id }))
  app.get('/api/v1/health', { schema: { response: { 200: schemas.Health } } }, async () => ({ status: 'ok', api_version: 'bench-intake-app/1' }))
  app.get('/api/v1/bootstrap', { schema: { response: { 200: schemas.Bootstrap } } }, async () => bootstrap(config, configured ? csrfToken : null))
  return app
}
