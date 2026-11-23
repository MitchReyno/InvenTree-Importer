import { vi } from 'vitest'
import type {
  AgentSessionListDto,
  AgentSettingsDto,
  AgentSettingsSaveResultDto,
  AgentSettingsUpdateDto,
} from '@invimport/contracts'
import { IntakeRequestError, type agentsClient } from '@invimport/contracts/client'

/** How the next save's answer reaches the browser. */
export type SaveDelivery =
  /** Answered normally. */
  | 'answer'
  /** Applied, then the answer is lost. */
  | 'lost-after-commit'
  /** Lost before it reached the server, so nothing applied. */
  | 'lost-before-commit'
  /** The browser gives up at once; the server applies it later, when the test says. */
  | 'late-commit'

type Receipt = { revision: string; base: string; payload: string }

function payloadOf({
  expected_revision: _revision,
  save_id: _saveId,
  ...fields
}: AgentSettingsUpdateDto) {
  return JSON.stringify(fields)
}

/**
 * An in-memory agent settings server with save receipts, as the intake server keeps them: a
 * resend of an applied save answers with its receipt, a resend over a pruned receipt can't be
 * told apart, and a stale revision is a conflict.
 */
export function agentSettingsServer(initial: AgentSettingsDto) {
  let saved = initial
  let prunedThrough = 0n
  const receipts = new Map<string, Receipt>()
  const deliveries: SaveDelivery[] = []
  const gates: Promise<void>[] = []
  const late: AgentSettingsUpdateDto[] = []

  function apply(request: AgentSettingsUpdateDto): AgentSettingsSaveResultDto {
    const receipt = receipts.get(request.save_id)
    if (receipt) {
      if (receipt.payload !== payloadOf(request) || receipt.base !== request.expected_revision) {
        throw new IntakeRequestError(409, 'save_receipt_mismatch')
      }
      return { save_id: request.save_id, revision: receipt.revision, replayed: true }
    }
    if (BigInt(request.expected_revision) < prunedThrough) {
      throw new IntakeRequestError(409, 'save_outcome_unknown')
    }
    if (request.expected_revision !== saved.revision) {
      throw new IntakeRequestError(412, 'revision_conflict')
    }
    const { expected_revision: base, save_id: saveId, ...fields } = request
    saved = { ...fields, revision: String(BigInt(base) + 1n) }
    receipts.set(saveId, { revision: saved.revision, base, payload: payloadOf(request) })
    return saved
  }

  const client = {
    settings: vi.fn(async () => saved),
    saveSettings: vi.fn(async (request: AgentSettingsUpdateDto) => {
      const gate = gates.shift()
      if (gate) {
        await gate
      }
      const delivery = deliveries.shift() ?? 'answer'
      if (delivery === 'lost-before-commit') {
        throw new TypeError('network_failed')
      }
      if (delivery === 'late-commit') {
        late.push(request)
        throw new DOMException('deadline', 'TimeoutError')
      }
      const result = apply(request)
      if (delivery === 'lost-after-commit') {
        throw new TypeError('network_failed')
      }
      return result
    }),
    sessions: vi.fn(
      async (): Promise<AgentSessionListDto> =>
        ({
          sessions: [],
          next_before: null,
          sessions_supported: true,
          paused_batch_ids: [],
        }) as unknown as AgentSessionListDto,
    ),
    failure: vi.fn(),
    pause: vi.fn(),
    pauseAll: vi.fn(async (paused: boolean) => ({ paused, batch_ids: [] })),
    deliverInstructions: vi.fn(),
  }

  return {
    client,
    asClient: () => client as unknown as ReturnType<typeof agentsClient>,
    get saved() {
      return saved
    },
    /** The saves the browser sent, in order. */
    sent: () => client.saveSettings.mock.calls.map(([request]) => request),
    /** How the next saves' answers are delivered. */
    deliver(...next: SaveDelivery[]) {
      deliveries.push(...next)
    },
    /** Holds the next save until the returned function is called. */
    hold() {
      let open = () => {}

      gates.push(
        new Promise<void>((resolve) => {
          open = resolve
        }),
      )
      return () => open()
    },
    /** Applies a save the browser already gave up on. */
    commitLate() {
      const request = late.shift()
      if (request) {
        apply(request)
      }
    },
    /** Another tab saves a change. */
    otherTab(change: Partial<Omit<AgentSettingsDto, 'revision'>>) {
      saved = { ...saved, ...change, revision: String(BigInt(saved.revision) + 1n) }
    },
    /** Prunes every receipt, as age or count would. */
    prune() {
      receipts.clear()
      prunedThrough = BigInt(saved.revision)
    },
  }
}

export type AgentSettingsServer = ReturnType<typeof agentSettingsServer>
