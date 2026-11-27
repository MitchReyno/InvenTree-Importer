import type {
  BulkEditDto,
  InstructionEditDto,
  IssueDispositionDto,
  RestructureDto,
} from './operator-review.ts'
import { successfulData } from './client-policy.ts'
import { typedClient, commandHeaders } from './client-runtime.ts'

/** Operator review reads and revision-bound commands; previews commit nothing. */
export function operatorReviewClient(
  baseUrl: string,
  csrfToken: string,
  transport: typeof fetch = fetch,
) {
  const client = typedClient(baseUrl, transport, csrfToken)

  return {
    read: (id: string) =>
      successfulData(
        client.GET('/api/v1/batches/{id}/operator-review', {
          params: { path: { id } },
        }),
      ),

    dismiss: (id: string, input: IssueDispositionDto, key: string) =>
      successfulData(
        client.POST('/api/v1/batches/{id}/issue-dispositions', {
          params: { path: { id } },
          body: input,
          headers: commandHeaders(key),
        }),
      ),

    bulkEdit: (id: string, input: BulkEditDto, key: string) =>
      successfulData(
        client.POST('/api/v1/batches/{id}/bulk-edits', {
          params: { path: { id } },
          body: input,
          headers: commandHeaders(key),
        }),
      ),

    restructure: (id: string, input: RestructureDto, key: string) =>
      successfulData(
        client.POST('/api/v1/batches/{id}/restructures', {
          params: { path: { id } },
          body: input,
          headers: commandHeaders(key),
        }),
      ),

    instruct: (id: string, input: InstructionEditDto, key: string) =>
      successfulData(
        client.POST('/api/v1/batches/{id}/instructions', {
          params: { path: { id } },
          body: input,
          headers: commandHeaders(key),
        }),
      ),
  }
}
