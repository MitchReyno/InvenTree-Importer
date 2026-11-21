import { NativeAgentResult, validate, type NativeAgentResultDto } from '@invimport/contracts'
import { strictJson } from '@invimport/contracts/json'
export { NativeAgentResult }

export function decodeNativeResult(value: unknown): NativeAgentResultDto {
  const parsed: unknown = typeof value === 'string' ? strictJson(value) : value
  validate('NativeAgentResult', parsed)
  const result = parsed as NativeAgentResultDto
  if ((result.proposal === null) === (result.question === null)) {
    throw new Error('agent_result_invalid')
  }
  return result
}
