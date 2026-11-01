import { useQuery } from '@tanstack/react-query'
import type { processingClient } from '@invimport/contracts/client'
import { RETAINED_POLL_INTERVAL_MS } from '../../queries/client'
import { serverQueryKey, useServerScope } from '../../queries/scope'
import { Link, Small } from '../ui/primitives'

type Client = Pick<ReturnType<typeof processingClient>, 'activity'>

export function ProcessingActivity({ client }: { client: Client }) {
  const scope = useServerScope()
  const query = useQuery({
    queryKey: serverQueryKey(scope, 'processing-activity'),
    queryFn: () => client.activity(),
    refetchInterval: RETAINED_POLL_INTERVAL_MS,
  })
  const activity = query.isFetchedAfterMount ? query.data : undefined
  if (query.isError || query.fetchStatus === 'paused') {
    return <span>Processing activity unavailable</span>
  }
  if (!activity) {
    return <span>Reading processing activity…</span>
  }

  const waiting = activity.jobs.filter((job) => job.state === 'waiting_for_user').length
  const active = activity.jobs.find((job) => job.occupies_lane)
  const first = active ?? activity.jobs[0]
  const lane = activity.lane_occupied ? 'Processing lane occupied' : 'Processing lane available'
  return (
    <>
      <span>
        {lane} · {waiting} need answers
      </span>
      {first && <Link href={`#${first.batch_id}/processing/overview`}>Open processing</Link>}
      {activity.truncated && <Small>Showing the first 100 retained processing jobs.</Small>}
    </>
  )
}
