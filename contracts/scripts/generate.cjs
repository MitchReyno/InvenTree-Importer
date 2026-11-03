const { mkdir, readFile, writeFile } = require('node:fs/promises')
const { resolve } = require('node:path')
const generateOpenApiTypes = require('@invimport/openapi-generator')
// Pinned Node natively erases the runtime schema module's types; no tsx/tool loader.
const { schemas, Id, Revision, MEDIA_SOURCE_MAX_BYTES } = require('../src/index.ts')

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
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']) {
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
      const [successStatus, success] = successes[0]
      const representations = Object.entries(success.content ?? {})
      if (operation['x-intake-browser-resource'] === true) {
        const [mediaType, representation] = representations[0] ?? []
        if (
          method !== 'get' ||
          operation.requestBody ||
          successStatus !== '200' ||
          representations.length !== 1 ||
          !['application/octet-stream', 'image/png'].includes(mediaType) ||
          representation?.schema?.type !== 'string' ||
          representation.schema.format !== 'binary'
        ) {
          throw new Error('invalid_browser_resource_representation')
        }
        continue
      }
      if (representations.length !== 1 || representations[0][0] !== 'application/json') {
        throw new Error('client_json_response_required')
      }
      const policy = operation['x-intake-client']
      if (
        !policy ||
        !Number.isSafeInteger(policy.timeoutMs) ||
        policy.timeoutMs <= 0 ||
        !['typed', 'setup'].includes(policy.errorMode)
      ) {
        throw new Error('client_operation_policy_required')
      }
      const responseSchema = schemaName(success.content['application/json'].schema.$ref)
      const requestContent = operation.requestBody?.content
      const requestReference = requestContent?.['application/json']?.schema.$ref
      const rawBody = requestContent?.['application/octet-stream']?.schema
      if (
        requestContent &&
        (Object.keys(requestContent).length !== 1 ||
          (!requestReference && !(rawBody?.type === 'string' && rawBody.format === 'binary')))
      ) {
        throw new Error('unsupported_client_request_representation')
      }
      policies.push([
        `${method.toUpperCase()} ${path}`,
        {
          ...operation['x-intake-client'],
          responseSchema,
          ...(requestReference ? { requestSchema: schemaName(requestReference) } : {}),
          ...(rawBody ? { requestMediaType: 'application/octet-stream' } : {}),
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
  const commandResponses = (output, status = '200') => ({
    [status]: response(output),
    400: response('ErrorDto'),
    403: response('ErrorDto'),
    409: response('ErrorDto'),
    412: response('ErrorDto'),
    422: response('ErrorDto'),
    default: response('ErrorDto'),
  })
  const post = (input, output, status = '200', timeoutMs = MANUAL_TIMEOUT_MS) => ({
    'x-intake-client': { timeoutMs, errorMode: 'typed' },
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { $ref: `#/components/schemas/${input}` } } },
    },
    responses: commandResponses(output, status),
  })
  const browserResource = (mediaType, description) => ({
    'x-intake-browser-resource': true,
    description,
    responses: {
      200: {
        description,
        content: { [mediaType]: { schema: { type: 'string', format: 'binary' } } },
      },
      default: response('ErrorDto'),
    },
  })
  const document = {
    openapi: '3.1.0',
    info: { title: 'Bench Intake foundation', version: 'bench-intake-app/1' },
    paths: {
      '/api/v1/health': { get: get('Health', SETUP_TIMEOUT_MS, 'setup') },
      '/api/v1/readiness': { get: get('Readiness', SETUP_TIMEOUT_MS, 'setup') },
      '/api/v1/bootstrap': {
        get: get('Bootstrap', SETUP_TIMEOUT_MS, 'setup'),
      },
      '/api/v1/inbox': {
        get: {
          ...get('InboxList'),
          parameters: [
            { name: 'q', in: 'query', schema: schemas.CaptureListQuery.properties.q },
            { name: 'archived', in: 'query', schema: schemas.CaptureListQuery.properties.archived },
            { name: 'offset', in: 'query', schema: schemas.CaptureListQuery.properties.offset },
          ],
        },
      },
      '/api/v1/batches': {
        get: {
          ...get('CaptureList', CAPTURE_TIMEOUT_MS),
          parameters: [
            { name: 'q', in: 'query', schema: schemas.CaptureListQuery.properties.q },
            { name: 'archived', in: 'query', schema: schemas.CaptureListQuery.properties.archived },
            { name: 'offset', in: 'query', schema: schemas.CaptureListQuery.properties.offset },
          ],
        },
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
      '/api/v1/connection-status': { get: get('ConnectionStatus', CAPTURE_TIMEOUT_MS) },
      '/api/v1/header-work': {
        get: {
          ...get('HeaderWork', CAPTURE_TIMEOUT_MS),
          parameters: [{ name: 'batch_id', in: 'query', schema: Id }],
        },
      },
      '/api/v1/agent-settings': {
        get: get('AgentSettings', CAPTURE_TIMEOUT_MS),
        put: post('AgentSettingsUpdate', 'AgentSettings', '200', CAPTURE_TIMEOUT_MS),
      },
      '/api/v1/agent-sessions': {
        get: {
          ...get('AgentSessionList', CAPTURE_TIMEOUT_MS),
          parameters: [{ name: 'before', in: 'query', schema: Id }],
        },
      },
      '/api/v1/processing-activity': { get: get('ProcessingActivity', CAPTURE_TIMEOUT_MS) },
      '/api/v1/batches/{id}/processing': {
        get: get('ProcessingSnapshot', CAPTURE_TIMEOUT_MS),
        post: post('ProcessingStart', 'ProcessingReceipt', '202'),
      },
      '/api/v1/batches/{id}/processing/{jobId}/cancellation': {
        post: post('ProcessingCancellation', 'ProcessingReceipt', '200', CAPTURE_TIMEOUT_MS),
      },
      '/api/v1/batches/{id}/questions/{questionId}/answers': {
        post: post('ProcessingAnswer', 'ProcessingAnswerReceipt'),
      },
      '/api/v1/batches/{batchId}/media': { get: get('MediaSnapshot') },
      '/api/v1/batches/{batchId}/media/commands': { post: post('MediaEdit', 'MediaSnapshot') },
      '/api/v1/batches/{batchId}/media/originals': {
        post: {
          'x-intake-client': { timeoutMs: MANUAL_TIMEOUT_MS, errorMode: 'typed' },
          responses: commandResponses('MediaReceipt'),
          parameters: [
            { name: 'x-intake-media-revision', in: 'header', required: true, schema: Revision },
            {
              name: 'x-intake-media-label',
              in: 'header',
              required: true,
              schema: { type: 'string', minLength: 1, maxLength: 3072 },
              description: 'Percent-encoded UTF-8 label, decoded and validated by the server.',
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/octet-stream': {
                schema: { type: 'string', format: 'binary' },
                'x-intake-max-bytes': MEDIA_SOURCE_MAX_BYTES,
              },
            },
          },
        },
      },
      '/api/v1/batches/{batchId}/media/versions/{resourceId}': {
        get: browserResource(
          'application/octet-stream',
          'Private forced download; use a browser resource URL.',
        ),
      },
      '/api/v1/batches/{batchId}/media/previews/{resourceId}': {
        get: browserResource('image/png', 'Private image preview; use a browser resource URL.'),
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
      '/api/v1/batches/{id}/operator-review': { get: get('OperatorReview') },
      '/api/v1/batches/{id}/issue-dispositions': {
        post: post('IssueDisposition', 'OperatorReview'),
      },
      '/api/v1/batches/{id}/bulk-edits': { post: post('BulkEdit', 'BulkEditResult') },
      '/api/v1/batches/{id}/restructures': { post: post('Restructure', 'RestructureResult') },
      '/api/v1/batches/{id}/instructions': { post: post('InstructionEdit', 'OperatorReview') },
    },
    components: { schemas },
  }
  for (const [path, item] of Object.entries(document.paths)) {
    const names = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1])
    if (names.length > 0) {
      item.parameters = names.map((name) => ({ name, in: 'path', required: true, schema: Id }))
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
export { captureClient, inboxClient, manualClient, intakeClient, IntakeRequestError } from '../src/client.ts'
export { agentsClient } from '../src/client-agents.ts'
export { processingClient } from '../src/client-processing.ts'
export { mediaClient } from '../src/client-media.ts'
export { operatorReviewClient } from '../src/client-operator-review.ts'
`,
  }
  await writeArtifacts(files)
}
module.exports = { clientPolicies }

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
