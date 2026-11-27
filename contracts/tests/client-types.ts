import createClient from 'openapi-fetch'
import type { paths, CaptureSnapshot } from '../generated/api.d.ts'
import { captureClient } from '../generated/client.ts'

/** Compile-only adverse cases: a changed API must invalidate incompatible callers. */
export function checkClientTypes() {
  const client = createClient<paths>({ baseUrl: 'http://127.0.0.1:4310' })
  // @ts-expect-error Missing required path identity.
  void client.GET('/api/v1/batches/{id}')
  // @ts-expect-error Nonexistent routes cannot be sent through this typed API.
  void client.POST('/api/v1/invented')
  void client.POST('/api/v1/runs/{id}/start', {
    params: { path: { id: 'id' } },
    // @ts-expect-error A string revision cannot silently become a JS number.
    body: { expected_run_revision: 1 },
  })
  // @ts-expect-error Capture input must retain its required note field.
  void client.POST('/api/v1/batches', { body: { title: 'Missing note' } })

  const facade = captureClient('http://127.0.0.1:4310', 'csrf')
  const snapshot: Promise<CaptureSnapshot> = facade.read('id')
  return snapshot
}
