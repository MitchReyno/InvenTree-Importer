import { setTimeout as delay } from 'node:timers/promises'
import type { Pool } from 'pg'
import type { CaptureBinding } from '#/capture/model.ts'
import type { BlobStore } from './blob-store.ts'
import { mediaWorkerStep, pauseAfter } from './backfill.ts'
import { processMediaCommand } from './worker.ts'
import { renderFigureStep, sweepFigureRenders } from './figure-renders.ts'
import { isolatedViewRenderer, RENDER_SWEEP_INTERVAL_MS } from './figure-render-consumer.ts'
import { withDecoderAdmission } from './decoder-admission.ts'

/** The primary lane serves maintenance between decodes. A second lane serves photos only. */
export async function drainMedia(
  pool: Pool,
  store: BlobStore,
  binding: CaptureBinding,
  image: string,
  slots: 1 | 2,
  signal: AbortSignal,
) {
  const failed = new AbortController()
  const stop = AbortSignal.any([signal, failed.signal])
  const render = isolatedViewRenderer(image)
  let nextSweep = 0

  async function primaryStep() {
    const step = await mediaWorkerStep(pool, store, binding, image)
    if (step === 'completed' || step === 'skipped_mismatch') {
      const event = step === 'completed' ? 'renditions_backfilled' : 'renditions_skipped_mismatch'
      process.stdout.write(JSON.stringify({ event }) + '\n')
    }
    if (stop.aborted) {
      return !pauseAfter(step)
    }
    if (Date.now() >= nextSweep) {
      await sweepFigureRenders(pool, store, binding)
      nextSweep = Date.now() + RENDER_SWEEP_INTERVAL_MS
    }
    if (stop.aborted) {
      return !pauseAfter(step)
    }
    const figure = await withDecoderAdmission(image, 'figure', 'idle' as const, () =>
      renderFigureStep(pool, store, binding, render),
    )
    if (figure === 'idle') {
      return !pauseAfter(step)
    }
    process.stdout.write(JSON.stringify({ event: 'figure_render', outcome: figure }) + '\n')
    return true
  }

  async function lane(step: () => Promise<boolean>) {
    try {
      while (!stop.aborted) {
        const worked = await step()
        if (!worked && !stop.aborted) {
          await delay(500, undefined, { signal: stop }).catch(() => undefined)
        }
      }
    } catch (error) {
      failed.abort()
      throw error
    }
  }

  const lanes = [lane(primaryStep)]
  if (slots === 2) {
    lanes.push(lane(() => processMediaCommand(pool, store, binding, image)))
  }
  const results = await Promise.allSettled(lanes)
  for (const result of results) {
    if (result.status === 'rejected') {
      throw result.reason
    }
  }
}
