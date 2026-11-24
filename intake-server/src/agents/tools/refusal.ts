import type { SessionToolErrorDto, ValidationIssue } from '@invimport/contracts'

/** A tool call refused with a typed result the agent can act on; nothing it did is kept. */
export class ToolRefusal extends Error {
  constructor(
    readonly code: SessionToolErrorDto,
    message: string,
    readonly issues?: ValidationIssue[],
  ) {
    super(message)
  }
}

export const refuse = (code: SessionToolErrorDto, message: string): never => {
  throw new ToolRefusal(code, message)
}
