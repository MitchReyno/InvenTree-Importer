import { schemas } from '@invimport/contracts'
import { canonical } from '@invimport/contracts/json'
import { refuseResearch } from './errors.ts'
import { MAX_RESEARCH_TOOL_CALLS } from './limits.ts'

export interface ResearchProtocolSession {
  send(frame: unknown): Promise<void>
  messages: AsyncIterable<unknown>
  close(): Promise<void>
}

export type ResearchRpcId = string | number

export interface ResearchToolCall {
  id: ResearchRpcId
  threadId: string
  turnId: string
  callId: string
  tool: string
  args: unknown
  fingerprint: string
}

export const MAX_RESEARCH_PROTOCOL_FRAMES = MAX_RESEARCH_TOOL_CALLS * 8

export const researchNamespace = 'bench_intake'

const brokerTools = {
  read_evidence: ['Read an exact staged evidence chunk.', schemas.ResearchEvidenceRead],
  lookup_inventory: ['Read one configured inventory observation.', schemas.ResearchInventoryLookup],
  fetch_source: ['Read one exact server-admitted source.', schemas.ResearchSourceFetch],
  read_source: ['Read an exact retained source chunk.', schemas.ResearchReceiptRead],
} as const

export type ResearchBrokerTool = keyof typeof brokerTools

export const researchBrokerTools = new Set(Object.keys(brokerTools))

export function isResearchBrokerTool(value: string): value is ResearchBrokerTool {
  return Object.hasOwn(brokerTools, value)
}

export const researchSemanticTools = new Set(['submit_proposal', 'ask_question'])

export function protocolRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    return refuseResearch('research_protocol_invalid')
  }
  return value as Record<string, unknown>
}

export function protocolKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).some((key) => !keys.includes(key))) {
    refuseResearch('research_protocol_invalid')
  }
}

export function protocolIdentity(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    return refuseResearch('research_protocol_invalid')
  }
  return value
}

export function rpcIdentity(value: unknown): ResearchRpcId {
  if (typeof value === 'string') {
    return protocolIdentity(value)
  }
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    Object.is(value, -0)
  ) {
    return refuseResearch('research_protocol_invalid')
  }
  return value
}

export function rpcKey(id: ResearchRpcId): string {
  return `${typeof id}:${id}`
}

export function initializationRequest(id: string) {
  return {
    id,
    method: 'initialize',
    params: {
      clientInfo: { name: 'bench_intake_fixture', version: '1' },
      capabilities: { experimentalApi: true },
    },
  }
}

export function threadRequest(id: string, instructions: string) {
  const tools: { name: string; description: string; inputSchema: unknown }[] = Object.entries(
    brokerTools,
  ).map(([name, [description, inputSchema]]) => ({
    name,
    description,
    inputSchema,
  }))
  tools.push(
    {
      name: 'submit_proposal',
      description: 'Retain a source-bound candidate.',
      inputSchema: schemas.ProcessingProposalV3,
    },
    {
      name: 'ask_question',
      description: 'End this attempt with an application question.',
      inputSchema: schemas.ProcessingQuestionSpec,
    },
  )
  return {
    id,
    method: 'thread/start',
    params: {
      ephemeral: true,
      approvalPolicy: 'never',
      sandbox: 'read-only',
      baseInstructions: instructions,
      dynamicTools: [
        {
          type: 'namespace',
          name: researchNamespace,
          description: 'Bounded fixture research.',
          tools,
        },
      ],
    },
  }
}

export function toolCall(
  frame: Record<string, unknown>,
  threadId: string,
  turnId: string,
): ResearchToolCall {
  protocolKeys(frame, ['id', 'method', 'params'])
  if (frame.method !== 'item/tool/call') {
    return refuseResearch('research_tool_refused')
  }
  const params = protocolRecord(frame.params)
  protocolKeys(params, ['threadId', 'turnId', 'callId', 'namespace', 'tool', 'arguments'])
  if (
    params.threadId !== threadId ||
    params.turnId !== turnId ||
    params.namespace !== researchNamespace
  ) {
    refuseResearch('research_protocol_invalid')
  }
  const tool = protocolIdentity(params.tool)
  if (!researchBrokerTools.has(tool) && !researchSemanticTools.has(tool)) {
    refuseResearch('research_tool_refused')
  }
  let fingerprint: string
  try {
    fingerprint = canonical({ tool, args: params.arguments })
  } catch {
    return refuseResearch('research_protocol_invalid')
  }
  return {
    id: rpcIdentity(frame.id),
    threadId,
    turnId,
    callId: protocolIdentity(params.callId),
    tool,
    args: params.arguments,
    fingerprint,
  }
}

export function toolResponse(id: ResearchRpcId, result: unknown) {
  return {
    id,
    result: { contentItems: [{ type: 'inputText', text: JSON.stringify(result) }], success: true },
  }
}
