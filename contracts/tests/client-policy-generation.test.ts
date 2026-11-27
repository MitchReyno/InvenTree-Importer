import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'

const { clientPolicies } = createRequire(import.meta.url)('../scripts/generate.cjs')

function resource() {
  return {
    'x-intake-browser-resource': true,
    responses: {
      200: { content: { 'image/png': { schema: { type: 'string', format: 'binary' } } } },
    },
  }
}

test('only explicit read-only binary browser resources may bypass JSON policy', () => {
  assert.deepEqual(clientPolicies({ '/preview': { get: resource() } }), [])
  assert.throws(
    () => clientPolicies({ '/upload': { post: resource() } }),
    /invalid_browser_resource/,
  )
  assert.throws(
    () => clientPolicies({ '/preview': { get: { ...resource(), requestBody: {} } } }),
    /invalid_browser_resource/,
  )
  const binary = resource()
  delete (binary as Partial<typeof binary>)['x-intake-browser-resource']
  assert.throws(
    () => clientPolicies({ '/preview': { get: binary } }),
    /client_json_response_required/,
  )
  const disguised = resource()
  disguised.responses[200].content['image/png'].schema.format = 'json'
  assert.throws(
    () => clientPolicies({ '/preview': { get: disguised } }),
    /invalid_browser_resource/,
  )
})

test('JSON operations require registered runtime schemas and explicit bounded policy', () => {
  const operation = {
    responses: {
      200: {
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Health' },
          },
        },
      },
    },
  }
  assert.throws(
    () => clientPolicies({ '/invented': { put: operation } }),
    /client_operation_policy_required/,
  )
  const checked = { ...operation, 'x-intake-client': { timeoutMs: 10000, errorMode: 'typed' } }
  assert.equal(clientPolicies({ '/invented': { put: checked } }).length, 1)
  assert.throws(
    () =>
      clientPolicies({
        '/invented': {
          post: {
            ...checked,
            requestBody: {
              content: {
                'application/xml': { schema: { type: 'string' } },
              },
            },
          },
        },
      }),
    /unsupported_client_request_representation/,
  )
})

test('a question figure route declares its position and size, not IDs', async () => {
  const { readFile } = await import('node:fs/promises')
  const document = JSON.parse(
    await readFile(new URL('../generated/openapi.json', import.meta.url), 'utf8'),
  ) as { paths: Record<string, { parameters?: { name: string; schema: unknown }[] }> }
  const route =
    document.paths[
      '/api/v1/batches/{batchId}/processing/sessions/{jobId}/questions/{questionId}/figures/{index}/{size}'
    ]
  const schemas = Object.fromEntries(
    (route.parameters ?? []).map((parameter) => [parameter.name, parameter.schema]),
  )
  assert.deepEqual(schemas.index, { type: 'integer', minimum: 1, maximum: 5 })
  assert.deepEqual(schemas.size, { type: 'string', enum: ['view', 'thumb'] })
  assert.deepEqual(schemas.questionId, schemas.jobId)
})
