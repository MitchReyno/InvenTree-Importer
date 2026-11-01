import { useQuery } from '@tanstack/react-query'
import { serverQueryKey, useServerScope } from '../../queries/scope'
import { RETAINED_POLL_INTERVAL_MS } from '../../queries/client'
import styled from 'styled-components'
import type { ManualClient } from '../../manual/types'
import { Link, Small } from './primitives'

export function ActivityIndicator({ client }: { client: ManualClient }) {
  const scope = useServerScope()
  const activityQuery = useQuery({
    queryKey: serverQueryKey(scope, 'activity'),
    queryFn: () => client.activity(),
    refetchInterval: RETAINED_POLL_INTERVAL_MS,
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
  return (
    <Indicator aria-label="Application activity" aria-live="polite">
      {unavailable
        ? 'Activity unavailable'
        : activity
          ? `${running} running · ${queued} awaiting apply · ${attention} need attention`
          : 'Reading activity…'}
      {first && <Link href={`#${first.batch_id}/results/${first.run_id}`}>Open original run</Link>}
      {activity?.truncated && <Small>Showing the first 100 retained runs.</Small>}
    </Indicator>
  )
}

const Indicator = styled.aside`
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 9px 12px;
  margin: 12px 0;
  border: 1px solid #d5dce5;
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
  color: #526179;
`
