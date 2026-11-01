const { mkdir, readFile, writeFile } = require('node:fs/promises')
const { resolve } = require('node:path')
const generateOpenApiTypes = require('@invimport/openapi-generator')
// Pinned Node natively erases the runtime schema module's types; no tsx/tool loader.
const { schemas, Id } = require('../src/index.ts')

const SETUP_TIMEOUT_MS = 5000
const CAPTURE_TIMEOUT_MS = 10000
const MANUAL_TIMEOUT_MS = 45000

function schemaName(reference) {
  const prefix = '#/components/schemas/'
  if (typeof reference !== 'string' || !reference.startsWith(prefix)) {
    throw new Error('client_schema_reference_required')
  }
  const name = reference.slice(prefix.length)
  if (!Object.hasOwn(schemas, name)) {
    throw new Error('unregistered_client_schema')
  }

  return name
}

function clientPolicies(paths) {
  const policies = []
  for (const [path, item] of Object.entries(paths)) {
    for (const method of ['get', 'post']) {
      const operation = item[method]
      if (!operation) {
        continue
      }
      const successes = Object.entries(operation.responses).filter(([status]) =>
        /^2\d\d$/.test(status),
      )
      if (successes.length !== 1) {
        throw new Error('client_operation_requires_one_success_schema')
      }
      const responseSchema = schemaName(successes[0][1].content['application/json'].schema.$ref)
      const requestReference = operation.requestBody?.content['application/json'].schema.$ref
      policies.push([
        `${method.toUpperCase()} ${path}`,
        {
          ...operation['x-intake-client'],
          responseSchema,
          ...(requestReference ? { requestSchema: schemaName(requestReference) } : {}),
        },
      ])
    }
  }
  return policies
}

async function writeArtifacts(files) {
  await mkdir(resolve(__dirname, '../generated'), { recursive: true })
  for (const [name, value] of Object.entries(files)) {
    const path = resolve(__dirname, '../generated', name)
    if (process.argv.includes('--check')) {
      if ((await readFile(path, 'utf8')) !== value) {
        throw new Error(`generated_contract_drift:${name}`)
      }
    } else {
      await writeFile(path, value)
    }
  }
}

async function main() {
  const response = (name) => ({
    description: name,
    content: { 'application/json': { schema: { $ref: `#/components/schemas/${name}` } } },
  })
  const get = (output, timeoutMs = MANUAL_TIMEOUT_MS, errorMode = 'typed') => ({
    'x-intake-client': { timeoutMs, errorMode },
    responses: { 200: response(output), default: response('ErrorDto') },
  })
  const post = (input, output, status = '200', timeoutMs = MANUAL_TIMEOUT_MS) => ({
    'x-intake-client': { timeoutMs, errorMode: 'typed' },
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { $ref: `#/components/schemas/${input}` } } },
    },
    responses: {
      [status]: response(output),
      400: response('ErrorDto'),
      403: response('ErrorDto'),
      409: response('ErrorDto'),
      412: response('ErrorDto'),
      422: response('ErrorDto'),
      default: response('ErrorDto'),
    },
  })
  const document = {
    openapi: '3.1.0',
    info: { title: 'Bench Intake foundation', version: 'bench-intake-app/1' },
    paths: {
      '/api/v1/health': { get: get('Health', SETUP_TIMEOUT_MS, 'setup') },
      '/api/v1/bootstrap': {
        get: get('Bootstrap', SETUP_TIMEOUT_MS, 'setup'),
      },
      '/api/v1/batches': {
        get: get('CaptureList', CAPTURE_TIMEOUT_MS),
        post: post('BatchCreate', 'CaptureSnapshot', '201', CAPTURE_TIMEOUT_MS),
      },
      '/api/v1/batches/{id}': {
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: Id,
          },
        ],
        get: get('CaptureSnapshot', CAPTURE_TIMEOUT_MS),
      },
      '/api/v1/batches/{id}/edits': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: Id }],
        post: post('CaptureEdit', 'CaptureSnapshot', '200', CAPTURE_TIMEOUT_MS),
      },
      '/api/v1/batches/{id}/observations': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: Id }],
        post: post('CaptureObserve', 'CaptureObservation', '201', CAPTURE_TIMEOUT_MS),
      },
      '/api/v1/activity': { get: get('ManualActivity') },
      '/api/v1/batches/{id}/manual': { get: get('ManualWorkspace') },
      '/api/v1/batches/{id}/reviews': { post: post('ManualScope', 'ManualReviewResult') },
      '/api/v1/batches/{id}/preparations': { post: post('ManualScope', 'ManualPreparationResult') },
      '/api/v1/preparations/{id}/approvals': { post: post('Approval', 'ManualAccepted') },
      '/api/v1/runs/{id}': { get: get('ManualRun') },
      '/api/v1/runs/{id}/start': { post: post('ManualRunCommand', 'ManualAccepted') },
      '/api/v1/runs/{id}/cancel': { post: post('ManualRunCommand', 'ManualAccepted') },
      '/api/v1/runs/{id}/recover': { post: post('ManualRecoveryCommand', 'ManualAccepted') },
    },
    components: { schemas },
  }
  for (const [path, item] of Object.entries(document.paths)) {
    if (path.includes('{id}') && !item.parameters) {
      item.parameters = [{ name: 'id', in: 'path', required: true, schema: Id }]
    }
  }
  const declarations = await generateOpenApiTypes(document)
  const aliases = Object.keys(schemas).map(
    (name) => `export type ${name} = components['schemas']['${name}']`,
  )
  const files = {
    'openapi.json': JSON.stringify(document, null, 2) + '\n',
    'api.d.ts': declarations + '\n' + aliases.join('\n') + '\n',
    'operations.ts': `// Generated by contracts/scripts/generate.cjs; do not edit.
import type { ClientOperation } from '../src/client-policy.ts'
export const clientOperations = new Map<string, ClientOperation>(${JSON.stringify(clientPolicies(document.paths), null, 2)})
`,
    'client.ts': `// Generated by contracts/scripts/generate.cjs; do not edit.
export { captureClient, manualClient, intakeClient, IntakeRequestError } from '../src/client.ts'
`,
  }
  await writeArtifacts(files)
}
main().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
})
