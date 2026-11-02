import { createHash, randomUUID } from 'node:crypto'
import { canonical } from '@invimport/contracts/json'
import {
  validate,
  type ProcessingEnvelopeDto,
  type ProcessingProposalV3Dto,
  type ProcessingQuestionSpecDto,
} from '@invimport/contracts'
import type { ResearchInput, RestrictedResearchRunner } from '../processing/runner.ts'
import type { ResearchBrokerFactory, ResearchToolBroker } from './broker.ts'
import { awaitResearchResult } from './abort.ts'
import {
  ResearchError,
  ResearchReapPendingError,
  assertResearchActive,
  refuseResearch,
} from './errors.ts'
import {
  MAX_RESEARCH_FRAME_BYTES,
  MAX_RESEARCH_SESSION_MS,
  MAX_RESEARCH_TOOL_CALLS,
} from './limits.ts'
import {
  initializationRequest,
  MAX_RESEARCH_PROTOCOL_FRAMES,
  isResearchBrokerTool,
  protocolIdentity,
  protocolKeys,
  protocolRecord,
  rpcKey,
  threadRequest,
  toolCall,
  toolResponse,
  type ResearchProtocolSession,
  type ResearchToolCall,
} from './protocol.ts'

export type ResearchSessionFactory = (
  input: ResearchInput,
  signal: AbortSignal,
) => Promise<ResearchProtocolSession>

export interface RestrictedResearchRunnerOptions {
  createSession: ResearchSessionFactory
  createBroker: ResearchBrokerFactory
  signal?: AbortSignal
  sessionTimeoutMs?: number
}

type HostEmission = { kind: 'proposal'; payload: ProcessingProposalV3Dto } | FinalOutcome

type FinalOutcome =
  | { kind: 'question'; payload: ProcessingQuestionSpecDto }
  | { kind: 'terminal'; payload: { state: 'ready' | 'failed' | 'interrupted' } }

interface CompletedCall {
  fingerprint: string
  result: unknown
}

const argumentSchemas = {
  read_evidence: 'ResearchEvidenceRead',
  lookup_inventory: 'ResearchInventoryLookup',
  fetch_source: 'ResearchSourceFetch',
  read_source: 'ResearchReceiptRead',
} as const

const resultSchemas = {
  read_evidence: 'ResearchEvidenceChunk',
  lookup_inventory: 'ResearchInventoryResult',
  fetch_source: 'ResearchSourceChunk',
  read_source: 'ResearchSourceChunk',
} as const

function turnRequest(id: string, threadId: string, input: ResearchInput) {
  return {
    id,
    method: 'turn/start',
    params: { threadId, input: [{ type: 'text', text: JSON.stringify(input.manifest) }] },
  }
}

function safeInput(input: ResearchInput) {
  validate('ProcessingInputV3', input.manifest)
  validate('ProcessingCommandV3', input.payload)
  const actualDigest = createHash('sha256').update(canonical(input.manifest)).digest('hex')
  const instructionsDigest = createHash('sha256').update(input.instructions).digest('hex')
  if (
    input.payload.input_sha256 !== actualDigest ||
    instructionsDigest !== input.manifest.instruction_sha256
  ) {
    refuseResearch('research_input_invalid')
  }
  if (
    Buffer.byteLength(JSON.stringify(turnRequest('preflight', 'x'.repeat(128), input))) >
    MAX_RESEARCH_FRAME_BYTES
  ) {
    refuseResearch('research_capacity')
  }
}

function terminalState(value: unknown): 'ready' | 'failed' | 'interrupted' {
  switch (value) {
    case 'completed':
      return 'ready'
    case 'failed':
      return 'failed'
    case 'interrupted':
      return 'interrupted'
    default:
      return refuseResearch('research_protocol_invalid')
  }
}

class ProtocolReader {
  private readonly iterator: AsyncIterator<unknown>
  private frames = 0

  constructor(
    session: ResearchProtocolSession,
    private readonly signal: AbortSignal,
  ) {
    this.iterator = session.messages[Symbol.asyncIterator]()
  }

  async next(): Promise<Record<string, unknown>> {
    this.frames += 1
    if (this.frames > MAX_RESEARCH_PROTOCOL_FRAMES) {
      refuseResearch('research_capacity')
    }
    const next = await awaitResearchResult(this.iterator.next(), this.signal)
    if (next.done) {
      refuseResearch('research_protocol_interrupted')
    }
    if (Buffer.byteLength(JSON.stringify(next.value)) > MAX_RESEARCH_FRAME_BYTES) {
      refuseResearch('research_capacity')
    }
    return protocolRecord(next.value)
  }

  async reply(id: string): Promise<Record<string, unknown>> {
    const frame = await this.next()
    protocolKeys(frame, ['id', 'result', 'error'])
    if (frame.id !== id || !('result' in frame) || 'error' in frame) {
      refuseResearch('research_protocol_invalid')
    }
    return protocolRecord(frame.result)
  }
}

async function sendFrame(session: ResearchProtocolSession, frame: unknown, signal: AbortSignal) {
  await awaitResearchResult(session.send(frame), signal)
}

async function startSession(
  session: ResearchProtocolSession,
  reader: ProtocolReader,
  input: ResearchInput,
  signal: AbortSignal,
) {
  const initializationId = randomUUID()
  await sendFrame(session, initializationRequest(initializationId), signal)
  await reader.reply(initializationId)
  await sendFrame(session, { method: 'initialized' }, signal)
  const threadId = randomUUID()
  await sendFrame(session, threadRequest(threadId, input.instructions), signal)
  const thread = protocolRecord((await reader.reply(threadId)).thread)
  const activeThread = protocolIdentity(thread.id)
  const turnId = randomUUID()
  await sendFrame(session, turnRequest(turnId, activeThread, input), signal)
  const turn = protocolRecord((await reader.reply(turnId)).turn)
  return { threadId: activeThread, turnId: protocolIdentity(turn.id) }
}

function passiveNotification(
  frame: Record<string, unknown>,
  threadId: string,
  turnId: string,
): void {
  protocolKeys(frame, ['method', 'params'])
  const params = protocolRecord(frame.params)
  if (params.threadId !== threadId || params.turnId !== turnId) {
    refuseResearch('research_protocol_invalid')
  }
  if (frame.method === 'item/started' || frame.method === 'item/completed') {
    const item = protocolRecord(params.item)
    if (!['dynamicToolCall', 'agentMessage'].includes(String(item.type))) {
      refuseResearch('research_tool_refused')
    }
    return
  }
  if (frame.method !== 'item/agentMessage/delta') {
    refuseResearch('research_tool_refused')
  }
}

async function brokerResult(
  broker: ResearchToolBroker,
  call: ResearchToolCall,
  requestId: string,
  signal: AbortSignal,
) {
  if (!isResearchBrokerTool(call.tool)) {
    refuseResearch('research_tool_refused')
  }
  validate(argumentSchemas[call.tool], call.args)
  const schema = resultSchemas[call.tool]
  const result = await awaitResearchResult(
    broker.call(call.tool, call.args, requestId, signal),
    signal,
  )
  validate(schema, result)
  return result
}

interface ActiveTurn {
  threadId: string
  turnId: string
}

interface ProtocolCallContext {
  input: ResearchInput
  session: ResearchProtocolSession
  broker: ResearchToolBroker
  signal: AbortSignal
  active: ActiveTurn
  emit: (message: HostEmission) => Promise<void>
}

class ProtocolCalls {
  private readonly completed = new Map<string, CompletedCall>()
  private readonly wireIds = new Map<string, string>()
  private calls = 0
  proposals = 0

  constructor(private readonly context: ProtocolCallContext) {}

  private identify(frame: Record<string, unknown>): ResearchToolCall {
    this.calls += 1
    if (this.calls > MAX_RESEARCH_TOOL_CALLS) {
      refuseResearch('research_capacity')
    }
    const { threadId, turnId } = this.context.active
    const call = toolCall(frame, threadId, turnId)
    const previous = this.wireIds.get(rpcKey(call.id))
    if (previous !== undefined && previous !== call.callId) {
      refuseResearch('research_protocol_invalid')
    }
    this.wireIds.set(rpcKey(call.id), call.callId)
    return call
  }

  private async question(call: ResearchToolCall): Promise<FinalOutcome> {
    validate('ProcessingQuestionSpec', call.args)
    const question = call.args as ProcessingQuestionSpecDto
    if (question.subject_id !== this.context.input.manifest.subject_id) {
      refuseResearch('research_protocol_invalid')
    }
    await sendFrame(
      this.context.session,
      toolResponse(call.id, { received: true, continuation: 'new_attempt' }),
      this.context.signal,
    )
    return { kind: 'question', payload: question }
  }

  private async execute(call: ResearchToolCall): Promise<unknown> {
    if (call.tool !== 'submit_proposal') {
      return brokerResult(this.context.broker, call, randomUUID(), this.context.signal)
    }
    validate('ProcessingProposalV3', call.args)
    const proposal = call.args as ProcessingProposalV3Dto
    if (proposal.subject_id !== this.context.input.manifest.subject_id) {
      refuseResearch('research_protocol_invalid')
    }
    await this.context.emit({ kind: 'proposal', payload: proposal })
    this.proposals += 1
    return { received: true }
  }

  async receive(frame: Record<string, unknown>): Promise<FinalOutcome | undefined> {
    const call = this.identify(frame)
    const previous = this.completed.get(call.callId)
    if (previous) {
      if (previous.fingerprint !== call.fingerprint) {
        refuseResearch('research_protocol_invalid')
      }
      await sendFrame(
        this.context.session,
        toolResponse(call.id, previous.result),
        this.context.signal,
      )
      return
    }
    if (call.tool === 'ask_question') {
      return this.question(call)
    }
    const result = await this.execute(call)
    this.completed.set(call.callId, { fingerprint: call.fingerprint, result })
    await sendFrame(this.context.session, toolResponse(call.id, result), this.context.signal)
  }
}

function completedOutcome(
  frame: Record<string, unknown>,
  active: ActiveTurn,
  proposals: number,
): FinalOutcome {
  protocolKeys(frame, ['method', 'params'])
  const params = protocolRecord(frame.params)
  const turn = protocolRecord(params.turn)
  if (params.threadId !== active.threadId || turn.id !== active.turnId) {
    refuseResearch('research_protocol_invalid')
  }
  const state = terminalState(turn.status)
  if (state === 'ready' && proposals === 0) {
    refuseResearch('research_protocol_invalid')
  }
  return { kind: 'terminal', payload: { state } }
}

async function runProtocol(
  input: ResearchInput,
  session: ResearchProtocolSession,
  broker: ResearchToolBroker,
  signal: AbortSignal,
  emit: (message: HostEmission) => Promise<void>,
): Promise<FinalOutcome> {
  const reader = new ProtocolReader(session, signal)
  const active = await startSession(session, reader, input, signal)
  const calls = new ProtocolCalls({ input, session, broker, signal, emit, active })
  while (true) {
    const frame = await reader.next()
    if (frame.method === 'turn/completed') {
      return completedOutcome(frame, active, calls.proposals)
    }
    if (!('id' in frame)) {
      passiveNotification(frame, active.threadId, active.turnId)
      continue
    }
    const question = await calls.receive(frame)
    if (question) {
      return question
    }
  }
}

const MAX_CLOSE_WAIT_MS = 2000

async function confirmedClose(session: ResearchProtocolSession): Promise<void> {
  let deadline: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      session.close(),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new ResearchReapPendingError()), MAX_CLOSE_WAIT_MS)
      }),
    ])
  } catch {
    throw new ResearchReapPendingError()
  } finally {
    clearTimeout(deadline)
  }
}

function envelopeEmitter(
  input: ResearchInput,
  emit: (message: ProcessingEnvelopeDto) => Promise<void>,
) {
  let sequence = 0n
  return async (message: HostEmission) => {
    sequence += 1n
    const envelope = {
      ...message,
      schema_version: 'bench-intake-runner/3',
      profile_id: 'restricted-research-stub/1',
      handler_version: 'processing/3',
      job_id: input.payload.job_id,
      attempt_id: input.payload.attempt_id,
      command_id: input.payload.command_id,
      input_sha256: input.payload.input_sha256,
      sequence: sequence.toString(),
    } as const
    validate('ProcessingEnvelopeV3', envelope)
    await emit(envelope)
  }
}

async function openBroker(
  input: ResearchInput,
  signal: AbortSignal,
  create: ResearchBrokerFactory,
) {
  const pending = create(input, signal)
  void pending
    .then((created) => {
      if (signal.aborted) {
        created.close()
      }
    })
    .catch(() => {})
  return awaitResearchResult(pending, signal)
}

async function openSession(
  input: ResearchInput,
  signal: AbortSignal,
  create: ResearchSessionFactory,
) {
  try {
    const pending = create(input, signal)
    void pending
      .then((created) => {
        if (signal.aborted) {
          void created.close().catch(() => {})
        }
      })
      .catch(() => {})
    return await awaitResearchResult(pending, signal)
  } catch {
    // A rejected factory has supplied no session whose physical cleanup can be confirmed.
    throw new ResearchReapPendingError()
  }
}

async function runRestrictedAttempt(
  input: ResearchInput,
  options: RestrictedResearchRunnerOptions,
  timeout: number,
  emit: (message: ProcessingEnvelopeDto) => Promise<void>,
): Promise<void> {
  safeInput(input)
  const lifetime = new AbortController()
  const deadline = setTimeout(() => lifetime.abort(), timeout)
  const signals = options.signal ? [lifetime.signal, options.signal] : [lifetime.signal]
  const signal = AbortSignal.any(signals)
  const send = envelopeEmitter(input, emit)
  let session: ResearchProtocolSession | undefined
  let broker: ResearchToolBroker | undefined
  let outcome: FinalOutcome | undefined
  let failure: unknown
  try {
    assertResearchActive(signal)
    broker = await openBroker(input, signal, options.createBroker)
    session = await openSession(input, signal, options.createSession)
    outcome = await runProtocol(input, session, broker, signal, send)
  } catch (error) {
    failure = error
  } finally {
    clearTimeout(deadline)
    lifetime.abort()
    try {
      broker?.close()
    } catch (error) {
      failure ??= error
    }
    if (session) {
      await confirmedClose(session)
    }
  }
  if (failure) {
    if (failure instanceof ResearchError) {
      throw failure
    }
    throw new ResearchError('research_protocol_invalid', { cause: failure })
  }
  if (!outcome) {
    refuseResearch('research_protocol_interrupted')
  }
  if (options.signal?.aborted) {
    refuseResearch('research_cancelled')
  }
  await send(outcome)
}

/** Only an explicitly injected fixture session is supported; no native launcher is constructed. */
export function restrictedResearchRunner(
  options: RestrictedResearchRunnerOptions,
): RestrictedResearchRunner {
  const timeout = options.sessionTimeoutMs ?? MAX_RESEARCH_SESSION_MS
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > MAX_RESEARCH_SESSION_MS) {
    refuseResearch('research_request_invalid')
  }
  return {
    profileId: 'restricted-research-stub/1',
    qualification: 'fixture_only',
    run: (input, emit) => runRestrictedAttempt(input, options, timeout, emit),
  }
}
