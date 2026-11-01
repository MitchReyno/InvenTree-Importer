import type {
  ProcessingStartDto,
  ProcessingCancellationDto,
  ProcessingAnswerDto,
} from './processing.ts'
import { successfulData } from './client-policy.ts'
import { typedClient, commandHeaders } from './client-runtime.ts'

/** Application commands only; private runner capabilities never enter the client. */
export function processingClient(
  baseUrl: string,
  csrfToken: string,
  transport: typeof fetch = fetch,
) {
  const client = typedClient(baseUrl, transport, csrfToken)

  return {
    read: (id: string) =>
      successfulData(
        client.GET('/api/v1/batches/{id}/processing', {
          params: { path: { id } },
        }),
      ),

    start: (id: string, input: ProcessingStartDto, key: string) =>
      successfulData(
        client.POST('/api/v1/batches/{id}/processing', {
          params: { path: { id } },
          body: input,
          headers: commandHeaders(key),
        }),
      ),

    cancel: (id: string, jobId: string, input: ProcessingCancellationDto, key: string) =>
      successfulData(
        client.POST('/api/v1/batches/{id}/processing/{jobId}/cancellation', {
          params: { path: { id, jobId } },
          body: input,
          headers: commandHeaders(key),
        }),
      ),

    answer: (id: string, questionId: string, input: ProcessingAnswerDto, key: string) =>
      successfulData(
        client.POST('/api/v1/batches/{id}/questions/{questionId}/answers', {
          params: { path: { id, questionId } },
          body: input,
          headers: commandHeaders(key),
        }),
      ),

    activity: () => successfulData(client.GET('/api/v1/processing-activity')),
  }
}
