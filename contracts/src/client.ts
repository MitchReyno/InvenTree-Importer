import type {
  BatchCreate,
  CaptureEdit,
  CaptureObserve,
  ManualScope,
  Approval,
  ManualRunCommand,
  ManualRecoveryCommand,
} from '../generated/api.d.ts'
import { successfulData } from './client-policy.ts'
import { typedClient, commandHeaders } from './client-runtime.ts'

export { IntakeRequestError } from './client-policy.ts'

/** Compatibility facade; paths, request bodies and response types come from OpenAPI. */
export function captureClient(baseUrl: string, csrfToken: string, transport: typeof fetch = fetch) {
  const client = typedClient(baseUrl, transport, csrfToken)

  return {
    list: () => successfulData(client.GET('/api/v1/batches')),

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

export function manualClient(baseUrl: string, csrfToken: string, transport: typeof fetch = fetch) {
  const client = typedClient(baseUrl, transport, csrfToken)

  return {
    activity: () => successfulData(client.GET('/api/v1/activity')),

    workspace: (id: string) =>
      successfulData(client.GET('/api/v1/batches/{id}/manual', { params: { path: { id } } })),

    review: (id: string, input: ManualScope, key: string) =>
      successfulData(
        client.POST('/api/v1/batches/{id}/reviews', {
          params: { path: { id } },
          body: input,
          headers: commandHeaders(key),
        }),
      ),

    prepare: (id: string, input: ManualScope, key: string) =>
      successfulData(
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
      successfulData(client.GET('/api/v1/runs/{id}', { params: { path: { id } } })),

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

    bootstrap: () => successfulData(client.GET('/api/v1/bootstrap')),
  }
}
