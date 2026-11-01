import type { MediaEditDto } from './media.ts'
import { MEDIA_SOURCE_MAX_BYTES } from './media.ts'
import { Revision } from './scalars.ts'
import { successfulData } from './client-policy.ts'
import { typedClient, commandHeaders } from './client-runtime.ts'

function uploadHeaders(revision: string, label: string, bytes: Blob, key: string) {
  if (!(bytes instanceof Blob) || bytes.size === 0 || bytes.size > MEDIA_SOURCE_MAX_BYTES) {
    throw new Error('invalid_upload_size')
  }
  if (
    typeof revision !== 'string' ||
    !new RegExp(Revision.pattern!).test(revision) ||
    BigInt(revision) > 9223372036854775807n
  ) {
    throw new Error('invalid_contract')
  }
  if (
    typeof label !== 'string' ||
    !label.trim() ||
    [...label].length > 256 ||
    /[\u0000-\u001f\u007f]/.test(label)
  ) {
    throw new Error('invalid_upload_label')
  }
  return {
    ...commandHeaders(key),
    'content-type': 'application/octet-stream',
    'x-intake-media-revision': revision,
    'x-intake-media-label': encodeURIComponent(label),
  }
}

/** JSON receipts and snapshots; images/downloads remain native browser resources. */
export function mediaClient(baseUrl: string, csrfToken: string, transport: typeof fetch = fetch) {
  const client = typedClient(baseUrl, transport, csrfToken)

  return {
    snapshot: (batchId: string) =>
      successfulData(
        client.GET('/api/v1/batches/{batchId}/media', {
          params: { path: { batchId } },
        }),
      ),

    edit: (batchId: string, input: MediaEditDto, key: string) =>
      successfulData(
        client.POST('/api/v1/batches/{batchId}/media/commands', {
          params: { path: { batchId } },
          body: input,
          headers: commandHeaders(key),
        }),
      ),

    upload: async (batchId: string, revision: string, label: string, bytes: Blob, key: string) => {
      const headers = uploadHeaders(revision, label, bytes, key)
      return successfulData(
        client.POST('/api/v1/batches/{batchId}/media/originals', {
          params: { path: { batchId }, header: headers },
          body: bytes,
          headers,
          bodySerializer: (body) => body,
        }),
      )
    },
  }
}
