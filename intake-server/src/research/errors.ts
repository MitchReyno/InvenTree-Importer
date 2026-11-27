export type ResearchErrorCode =
  | 'research_request_invalid'
  | 'research_tool_refused'
  | 'research_input_invalid'
  | 'research_attempt_unavailable'
  | 'research_source_refused'
  | 'research_source_unavailable'
  | 'research_source_invalid'
  | 'research_capacity'
  | 'research_cancelled'
  | 'research_protocol_invalid'
  | 'research_protocol_interrupted'
  | 'research_native_unsupported'
  | 'research_receipt_missing'
  | 'research_receipt_corrupt'
  | 'research_evidence_invalid'
  | 'research_inventory_unavailable'
  | 'research_inventory_invalid'
  | 'research_reap_unconfirmed'

export class ResearchError extends Error {
  constructor(
    public readonly code: ResearchErrorCode,
    options?: ErrorOptions,
  ) {
    super(code, options)
    this.name = 'ResearchError'
  }
}

export class ResearchReapPendingError extends ResearchError {
  constructor() {
    super('research_reap_unconfirmed')
  }
}

export function refuseResearch(code: ResearchErrorCode): never {
  throw new ResearchError(code)
}

export function assertResearchActive(signal: AbortSignal): void {
  if (signal.aborted) {
    refuseResearch('research_cancelled')
  }
}
