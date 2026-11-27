import createClient from 'openapi-fetch'
import type { paths } from '../generated/api.d.ts'
import { mediaClient } from '../generated/client.ts'

export function checkMediaTypes() {
  const client = createClient<paths>()
  const headers = { 'x-intake-media-revision': '1', 'x-intake-media-label': 'packet' }
  const params = { path: { batchId: 'batch' }, header: headers }
  void client.POST('/api/v1/batches/{batchId}/media/originals', {
    params,
    headers,
    body: new Blob(['bytes']),
  })
  void client.POST('/api/v1/batches/{batchId}/media/originals', {
    params,
    headers,
    // @ts-expect-error Binary bodies are Blob, never a JSON/text substitute.
    body: 'bytes',
  })
  void client.GET('/api/v1/batches/{batchId}/media/previews/{resourceId}', {
    // @ts-expect-error Resource identity must be supplied alongside batch identity.
    params,
  })
  const facade = mediaClient('http://127.0.0.1:4310', 'csrf')
  // @ts-expect-error Exact revision cannot be coerced to a number.
  void facade.upload('batch', 1, 'label', new Blob(['bytes']), 'key')
}
