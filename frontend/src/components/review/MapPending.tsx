import { batchHref } from '../../navigation/batch-route'
import { Banner } from '../ui/Banner'

/** Review › Map arrives with the Review redesign; a direct link explains where to go instead. */
export function MapPending({ batchId }: { batchId: string }) {
  return (
    <Banner tone="info">
      The map of how photos became lots isn't available yet. Each lot's evidence is in{' '}
      <a href={batchHref(batchId, { tab: 'review', view: 'lots' })}>Lots</a>.
    </Banner>
  )
}
