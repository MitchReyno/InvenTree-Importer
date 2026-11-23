import type { BatchRoute } from '#/navigation/batch-route'
import { ProcessingSkeleton } from '#/components/processing/ProcessingSkeleton'
import { ReviewSkeleton } from '#/components/review/ReviewSkeleton'

/** The open tab's skeleton, until Capture's read lands on a first visit. */
export function TabSkeleton({ route }: { route: BatchRoute }) {
  return route.tab === 'processing' ? <ProcessingSkeleton view={route.step} /> : <ReviewSkeleton />
}
