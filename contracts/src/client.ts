import type {
  BatchCreate,
  CaptureEdit,
  CaptureObserve,
  ManualScope,
  Approval,
  ManualRunCommand,
  ManualRecoveryCommand,
  ManualWorkspace,
  ManualPreparationResult,
  ManualRun,
} from '../generated/api.d.ts'
import type { HeaderWorkQueryDto } from './header.ts'
import type { CaptureListQueryDto } from './capture.ts'
import type { CatalogueModelDto } from './catalogue.ts'
import { validate } from './index.ts'
import { successfulData } from './client-policy.ts'
import { typedClient, commandHeaders } from './client-runtime.ts'

export { IntakeRequestError } from './client-policy.ts'

/** Compatibility facade; paths, request bodies and response types come from OpenAPI. */
export function captureClient(baseUrl: string, csrfToken: string, transport: typeof fetch = fetch) {
  const client = typedClient(baseUrl, transport, csrfToken)

  return {
    list: (query: CaptureListQueryDto = {}) =>
      successfulData(client.GET('/api/v1/batches', { params: { query } })),

    read: (id: string) =>
      successfulData(client.GET('/api/v1/batches/{id}', { params: { path: { id } } })),

    create: (input: BatchCreate, key: string) =>
      successfulData(client.POST('/api/v1/batches', { body: input, headers: commandHeaders(key) })),

    edit: (id: string, input: CaptureEdit, key: string) =>
      successfulData(
        client.POST('/api/v1/batches/{id}/edits', {
          params: { path: { id } },
          body: input,
          headers: commandHeaders(key),
        }),
      ),

    observe: (id: string, input: CaptureObserve, key: string) =>
      successfulData(
        client.POST('/api/v1/batches/{id}/observations', {
          params: { path: { id } },
          body: input,
          headers: commandHeaders(key),
        }),
      ),
  }
}

/** Read-only bounded catalogue reads for reference pickers; results are not selections. */
export function catalogueClient(
  baseUrl: string,
  csrfToken: string,
  transport: typeof fetch = fetch,
) {
  const client = typedClient(baseUrl, transport, csrfToken)

  return {
    search: (id: string, model: CatalogueModelDto, q: string) =>
      successfulData(
        client.GET('/api/v1/batches/{id}/catalogue/{model}', {
          params: { path: { id, model }, query: { q } },
        }),
      ),

    candidates: (id: string, model: CatalogueModelDto) =>
      successfulData(
        client.GET('/api/v1/batches/{id}/catalogue/{model}/candidates', {
          params: { path: { id, model } },
        }),
      ),
  }
}

export function manualClient(baseUrl: string, csrfToken: string, transport: typeof fetch = fetch) {
  const client = typedClient(baseUrl, transport, csrfToken)

  return {
    activity: () => successfulData(client.GET('/api/v1/activity')),

    workspace: (id: string) =>
      manualWorkspaceResponse(
        client.GET('/api/v1/batches/{id}/manual', { params: { path: { id } } }),
      ),

    review: (id: string, input: ManualScope, key: string) =>
      successfulData(
        client.POST('/api/v1/batches/{id}/reviews', {
          params: { path: { id } },
          body: input,
          headers: commandHeaders(key),
        }),
      ),

    prepare: (id: string, input: ManualScope, key: string) =>
      manualPreparationResponse(
        client.POST('/api/v1/batches/{id}/preparations', {
          params: { path: { id } },
          body: input,
          headers: commandHeaders(key),
        }),
      ),

    approve: (input: Approval, key: string) =>
      successfulData(
        client.POST('/api/v1/preparations/{id}/approvals', {
          params: { path: { id: input.preparation_id } },
          body: input,
          headers: commandHeaders(key),
        }),
      ),

    run: (id: string) =>
      manualRunResponse(client.GET('/api/v1/runs/{id}', { params: { path: { id } } })),

    start: (id: string, input: ManualRunCommand, key: string) =>
      successfulData(
        client.POST('/api/v1/runs/{id}/start', {
          params: { path: { id } },
          body: input,
          headers: commandHeaders(key),
        }),
      ),

    cancel: (id: string, input: ManualRunCommand, key: string) =>
      successfulData(
        client.POST('/api/v1/runs/{id}/cancel', {
          params: { path: { id } },
          body: input,
          headers: commandHeaders(key),
        }),
      ),

    recover: (id: string, input: ManualRecoveryCommand, key: string) =>
      successfulData(
        client.POST('/api/v1/runs/{id}/recover', {
          params: { path: { id } },
          body: input,
          headers: commandHeaders(key),
        }),
      ),
  }
}

export function intakeClient(baseUrl: string, transport: typeof fetch = fetch) {
  const client = typedClient(baseUrl, transport)

  return {
    health: () => successfulData(client.GET('/api/v1/health')),

    readiness: () => successfulData(client.GET('/api/v1/readiness')),

    bootstrap: () => successfulData(client.GET('/api/v1/bootstrap')),
  }
}

// The pinned OpenAPI Readable helper drops null-only keys; these named decoders retain the validated wire union.
async function manualWorkspaceResponse(
  operation: Promise<{ data?: unknown }>,
): Promise<ManualWorkspace> {
  const value = await successfulData(operation)
  validate('ManualWorkspace', value)
  return value as ManualWorkspace
}

async function manualPreparationResponse(
  operation: Promise<{ data?: unknown }>,
): Promise<ManualPreparationResult> {
  const value = await successfulData(operation)
  validate('ManualPreparationResult', value)
  return value as ManualPreparationResult
}

async function manualRunResponse(operation: Promise<{ data?: unknown }>): Promise<ManualRun> {
  const value = await successfulData(operation)
  validate('ManualRun', value)
  return value as ManualRun
}

/** Read-only inbox observations never establish command authority. */
export function inboxClient(baseUrl: string, csrfToken: string, transport: typeof fetch = fetch) {
  const client = typedClient(baseUrl, transport, csrfToken)
  return {
    list: (query: CaptureListQueryDto = {}) =>
      successfulData(client.GET('/api/v1/inbox', { params: { query } })),
  }
}

export function headerClient(baseUrl: string, csrfToken: string, transport: typeof fetch = fetch) {
  const client = typedClient(baseUrl, transport, csrfToken)
  return {
    connection: () => successfulData(client.GET('/api/v1/connection-status')),
    work: (query: HeaderWorkQueryDto = {}) =>
      successfulData(client.GET('/api/v1/header-work', { params: { query } })),
  }
}
