import type {
  ProcessingStartDto,
  ProcessingCancellationDto,
  ProcessingAnswerDto,
} from './processing.ts'
import type { SessionInboxSubmissionDto, SessionReplacementDto } from './sessions.ts'
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
    failure: (attemptId: string, failureId: string) =>
      successfulData(
        client.GET('/api/v1/agent-sessions/{attemptId}/failures/{failureId}', {
          params: { path: { attemptId, failureId } },
        }),
      ),
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

    /** The newest recorded actions across the batch's sessions, with each job's latest status. */
    batchActivity: (id: string, limit?: number) =>
      successfulData(
        client.GET('/api/v1/batches/{id}/processing/activity', {
          params: {
            path: { id },
            ...(limit === undefined ? {} : { query: { limit: String(limit) } }),
          },
        }),
      ),

    /** The newest page of a session's history, or the page older than `before`. */
    history: (id: string, jobId: string, before?: string) =>
      successfulData(
        client.GET('/api/v1/batches/{id}/processing/{jobId}/history', {
          params: { path: { id, jobId }, ...(before === undefined ? {} : { query: { before } }) },
        }),
      ),

    replaceSession: (id: string, jobId: string, input: SessionReplacementDto, key: string) =>
      successfulData(
        client.POST('/api/v1/batches/{id}/processing/{jobId}/replacement', {
          params: { path: { id, jobId } },
          body: input,
          headers: commandHeaders(key),
        }),
      ),

    chat: (id: string, jobId: string, input: SessionInboxSubmissionDto, key: string) =>
      successfulData(
        client.POST('/api/v1/batches/{id}/processing/{jobId}/inbox', {
          params: { path: { id, jobId } },
          body: input,
          headers: commandHeaders(key),
        }),
      ),

    activity: () => successfulData(client.GET('/api/v1/processing-activity')),
  }
}
