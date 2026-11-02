import { useQuery } from '@tanstack/react-query'
import { serverQueryKey, useServerScope } from '../../queries/scope'
import { useRetainedPollInterval } from '../../live/LiveUpdates'
import styled from 'styled-components'
import type { processingClient } from '@invimport/contracts/client'
import { ProcessingActivity } from '../processing/ProcessingActivity'
import type { ManualClient } from '../../manual/types'
import { Link, Small } from './primitives'

export function ActivityIndicator({
  client,
  processing,
}: {
  client: ManualClient
  processing?: ReturnType<typeof processingClient>
}) {
  const pollInterval = useRetainedPollInterval()
  const scope = useServerScope()
  const activityQuery = useQuery({
    queryKey: serverQueryKey(scope, 'activity'),
    queryFn: () => client.activity(),
    refetchInterval: pollInterval,
  })
  const activity = activityQuery.isFetchedAfterMount ? activityQuery.data : undefined
  const unavailable = activityQuery.isError || activityQuery.fetchStatus === 'paused'
  const running =
    activity?.runs.filter((value) => value.state === 'running' || value.state === 'stopping')
      .length ?? 0
  const queued = activity?.runs.filter((value) => value.state === 'queued').length ?? 0
  const attention =
    activity?.runs.filter(
      (value) => value.state === 'recovery_required' || value.state === 'settled_incomplete',
    ).length ?? 0
  const first = activity?.runs[0]
  let status = 'Reading inventory activity…'
  if (unavailable) {
    status = 'Inventory activity unavailable'
  } else if (activity) {
    status = `Inventory: ${running} running · ${queued} awaiting apply · ${attention} need attention`
  }
  return (
    <Indicator aria-label="Application activity" aria-live="polite">
      <span>{status}</span>
      {first && <Link href={`#${first.batch_id}/results/${first.run_id}`}>Open original run</Link>}
      {processing && <ProcessingActivity client={processing} />}
      {activity?.truncated && <Small>Showing the first 100 retained runs.</Small>}
    </Indicator>
  )
}

const Indicator = styled.aside`
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 6px 10px;
  margin: 6px 0;
  border: 1px solid #d5dce5;
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
  color: #526179;
`
