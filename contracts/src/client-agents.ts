import type { AgentSettingsUpdateDto } from './agents.ts'
import { successfulData } from './client-policy.ts'
import { typedClient } from './client-runtime.ts'

export function agentsClient(baseUrl: string, csrfToken: string, transport: typeof fetch = fetch) {
  const client = typedClient(baseUrl, transport, csrfToken)
  return {
    failure: (attemptId: string, failureId: string) =>
      successfulData(
        client.GET('/api/v1/agent-sessions/{attemptId}/failures/{failureId}', {
          params: { path: { attemptId, failureId } },
        }),
      ),
    settings: () => successfulData(client.GET('/api/v1/agent-settings')),
    saveSettings: (input: AgentSettingsUpdateDto) =>
      successfulData(client.PUT('/api/v1/agent-settings', { body: input })),
    sessions: (before?: string) =>
      successfulData(client.GET('/api/v1/agent-sessions', { params: { query: { before } } })),
  }
}
