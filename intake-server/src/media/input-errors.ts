import { CaptureError } from '#/capture/model.ts'

export type MediaInputBlockerCode = 'media_not_ready' | 'media_input_capacity'
export type MediaInputUnavailableReason = 'not_ready' | 'capacity'

/** Expected scoped-input blockers; corruption and infrastructure failures use separate paths. */
export class MediaInputUnavailableError extends CaptureError {
  constructor(public readonly reason: MediaInputUnavailableReason) {
    super(
      reason === 'not_ready' ? 409 : 422,
      reason === 'not_ready' ? 'media_not_ready' : 'media_input_capacity',
    )
  }
}
