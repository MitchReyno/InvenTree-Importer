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
