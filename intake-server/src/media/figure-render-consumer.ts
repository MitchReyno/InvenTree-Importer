import { setTimeout as delay } from 'node:timers/promises'
import type { Pool } from 'pg'
import type { CaptureBinding } from '#/capture/model.ts'
import type { BlobStore } from './blob-store.ts'
import { renderViewIsolated } from './decoder-runner.ts'
import {
  FIGURE_RENDER_CHANNEL,
  renderFigureStep,
  sweepFigureRenders,
  type RenderView,
} from './figure-renders.ts'

/** The consumer polls this often when no notification arrives. */
export const RENDER_POLL_MS = 1_000
/** How often the consumer runs its retention sweep. */
export const RENDER_SWEEP_INTERVAL_MS = 10 * 60 * 1000

/** Renders views in the pinned decoder image, through the dispatcher when one is configured. */
export function isolatedViewRenderer(image: string): RenderView {
  return async (input) => {
    const result = await renderViewIsolated(image, { version: 'media-view/1', ...input })
    if (result.state !== 'ready') {
      return { state: 'malformed' }
    }
    return { state: 'ready', view: result.view, thumb: result.thumb, preview: result.preview }
  }
}

export interface RenderConsumerOptions {
  pool: Pool
  store: BlobStore
  binding: CaptureBinding
  render: RenderView
  signal: AbortSignal
  pollMs?: number
  sweepIntervalMs?: number
  onOutcome?: (outcome: string) => void
}

/**
 * Claims render requests until stopped: woken by the ask transaction's notification, polling as a
 * fallback, and sweeping retention on an interval. Expired leases are claimed again, so a consumer
 * that died mid-render is recovered by the next one.
 */
export async function runFigureRenderConsumer(options: RenderConsumerOptions) {
  const listener = await options.pool.connect()
  let wake: (() => void) | undefined
  listener.on('notification', () => wake?.())
  await listener.query(`LISTEN ${FIGURE_RENDER_CHANNEL}`)
  let nextSweep = 0
  try {
    while (!options.signal.aborted) {
      if (Date.now() >= nextSweep) {
        await sweepFigureRenders(options.pool, options.store, options.binding)
        nextSweep = Date.now() + (options.sweepIntervalMs ?? RENDER_SWEEP_INTERVAL_MS)
      }
      const outcome = await renderFigureStep(
        options.pool,
        options.store,
        options.binding,
        options.render,
      )
      options.onOutcome?.(outcome)
      if (outcome !== 'idle') {
        continue
      }
      const woken = new Promise<void>((resolve) => {
        wake = resolve
      })
      await Promise.race([
        woken,
        delay(options.pollMs ?? RENDER_POLL_MS, undefined, { signal: options.signal }).catch(
          () => undefined,
        ),
      ])
      wake = undefined
    }
  } finally {
    await listener.query(`UNLISTEN ${FIGURE_RENDER_CHANNEL}`).catch(() => undefined)
    listener.release()
  }
}
