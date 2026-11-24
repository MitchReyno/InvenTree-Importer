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
/**
 * Longer than the dispatcher client's interval between asks, so a decode waiting for the slot
 * asks while it is free.
 */
export const RENDER_YIELD_MS = 1_000
/** How often the consumer runs its retention sweep. */
export const RENDER_SWEEP_INTERVAL_MS = 10 * 60 * 1000

/** Renders views in the pinned decoder image, through the dispatcher when one is configured. */
export function isolatedViewRenderer(image: string): RenderView {
  return async (input) => {
    // A busy dispatcher is not waited for: the render is deferred and an upload's decode goes first.
    const result = await renderViewIsolated(
      image,
      { version: 'media-view/1', ...input },
      { busyWaitMs: 0 },
    )
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
  /** The pause after each render, so a decode waiting for the dispatcher gets its turn. */
  yieldMs?: number
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
  try {
    await listener.query(`LISTEN ${FIGURE_RENDER_CHANNEL}`)
  } catch (error) {
    // Not subscribed, so nothing needs undoing; the connection is discarded, not reused.
    listener.release(true)
    throw error
  }
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
        await delay(options.yieldMs ?? RENDER_YIELD_MS, undefined, {
          signal: options.signal,
        }).catch(() => undefined)
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
