import type { BatchRoute } from '#/navigation/batch-route'
import { CaptureSkeleton } from '#/components/capture/CaptureSkeleton'
import { ChangesSkeleton } from '#/components/changes/ChangesSkeleton'
import { ProcessingSkeleton } from '#/components/processing/ProcessingSkeleton'
import { RecordsSkeleton } from '#/components/review/records/RecordsSkeleton'
import { ReviewMapTabSkeleton } from '#/components/review/ReviewMapTabSkeleton'
import { ReviewSkeleton } from '#/components/review/ReviewSkeleton'

/** The open tab's skeleton, until Capture's read lands on a first visit. */
export function TabSkeleton({ route }: { route: BatchRoute }) {
  switch (route.tab) {
    case 'capture':
      return <CaptureSkeleton />
    case 'processing':
      return <ProcessingSkeleton view={route.step} />
    case 'changes':
      return <ChangesSkeleton />
    case 'review':
      return reviewSkeleton(route.view)
  }
}

/** Review's skeleton for its open view. */
function reviewSkeleton(view: Extract<BatchRoute, { tab: 'review' }>['view']) {
  switch (view) {
    case 'map':
      return <ReviewMapTabSkeleton />
    case 'records':
      return <RecordsSkeleton />
    case 'lots':
      return <ReviewSkeleton />
  }
}
