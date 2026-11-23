import type { ReactNode } from 'react'
import type { FreshPhase } from '#/queries/useFreshRead'
import { useReportRefreshing } from '#/context/RefreshSignalContext'
import { VisuallyHidden } from './VisuallyHidden'

type Props = {
  phase: FreshPhase
  /** Whether a failed read still has data to show; any other phase but `empty` has some. */
  hasData?: boolean
  /** The page's own layout in `Skeleton` blocks, shown until its first data. */
  skeleton: ReactNode
  /** The page's existing "Status unavailable" banner, shown while the read has failed. */
  failure?: ReactNode
  children: ReactNode
}

/**
 * A page's read state with nothing appearing and disappearing in its flow: the skeleton until data,
 * then the page at once. A refresh reports to `RefreshSignal`, which shows progress over the page.
 */
export function ReadState({ phase, hasData = true, skeleton, failure, children }: Props) {
  useReportRefreshing(phase === 'refreshing')

  if (phase === 'empty') {
    return (
      <div aria-busy="true">
        <VisuallyHidden role="status">Loading</VisuallyHidden>
        {skeleton}
      </div>
    )
  }
  const failed = phase === 'failed'

  // One shape for every phase with data, so a failing or recovering read never remounts the page
  // and its unsaved input.
  return (
    <>
      {failed && failure}
      {(!failed || hasData) && children}
    </>
  )
}
