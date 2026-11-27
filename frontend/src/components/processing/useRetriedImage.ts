import { useEffect, useRef, useState } from 'react'

type LoadAttempt = { src: string; retries: number; failed: boolean }

/** A picture that fails to load is tried again this many times, each a little later. */
const MAX_LOAD_RETRIES = 3
const LOAD_RETRY_DELAY_MS = 2_000
/** After the retries, a picture is asked for again this often while it is shown. */
const SLOW_RETRY_DELAY_MS = 30_000

/**
 * A rendered picture's loading. A read can say ready a moment before the route serves it, or a
 * load can fail on the way, so a failed load is tried again a few times before it counts as
 * failed, and then slowly for as long as it is shown, so it appears once the route serves it.
 */
export function useRetriedImage(src: string, onLoaded?: () => void) {
  const [loading, setLoading] = useState<LoadAttempt>({ src, retries: 0, failed: false })
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const attempt = loading.src === src ? loading : { src, retries: 0, failed: false }
  const imageSrc = attempt.retries === 0 ? src : `${src}?retry=${attempt.retries}`

  // The retry timer is the external system; it is cleared if the picture goes first.
  useEffect(() => () => clearTimeout(retryTimer.current), [])

  function handleError() {
    const failed = attempt.retries >= MAX_LOAD_RETRIES
    const delayMs = failed ? SLOW_RETRY_DELAY_MS : LOAD_RETRY_DELAY_MS * (attempt.retries + 1)
    setLoading({ ...attempt, failed })
    clearTimeout(retryTimer.current)
    retryTimer.current = setTimeout(
      () => setLoading({ src, retries: attempt.retries + 1, failed }),
      delayMs,
    )
  }

  function handleLoad() {
    onLoaded?.()
    if (attempt.failed) {
      setLoading({ ...attempt, failed: false })
    }
  }

  return { imageSrc, failed: attempt.failed, handleError, handleLoad }
}
