import type { DevConfig } from '../config.ts'

/** A refusal with a stable public code; routes publish it without a stack or cause. */
export class CaptureError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(code)
  }
}

export function fail(code: string, status = 422): never {
  throw new CaptureError(status, code)
}

export type CaptureBinding = Pick<DevConfig, 'actorId' | 'targetId' | 'targetContextId'>
