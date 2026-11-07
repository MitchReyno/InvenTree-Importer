import createClient from 'openapi-fetch'
import type { paths } from '../generated/api.d.ts'

export function checkProcessingTypes() {
  const client = createClient<paths>()
  void client.POST('/api/v1/batches/{id}/processing/{jobId}/cancellation', {
    // @ts-expect-error Every path identity is mandatory.
    params: { path: { id: 'id' } },
    body: { expected_revision: '1', attempt_id: 'id' },
  })
  void client.POST('/api/v1/batches/{id}/questions/{questionId}/answers', {
    // @ts-expect-error Question identity cannot disappear.
    params: { path: { id: 'id' } },
    body: {
      schema_version: 'bench-intake-answer/1',
      expected_question_revision: '1',
      expected_capture_revision: '1',
      attempt_id: 'id',
      input_sha256: 'digest',
      value: { kind: 'clarification', text: 'Human answer' },
    },
  })
}
