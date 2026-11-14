import type { ReactNode } from 'react'
import styled from 'styled-components'
import type { ConnectionStatusDto } from '@invimport/contracts'
import { color, size, space, typeVar } from '#/theme/generated/tokens'
import { LIVE_UPDATE_FRESH_MS } from '#/components/operations/LiveUpdates'
import { Button, DisabledFeature, KeyValue, media } from '#/components/ui'
import { observationFresh, safeTargetNavigation, timestampFresh } from '#/header/observations'
import { DevBadge } from './DevBadge'
import { type UpdateHealth } from '#/context'

interface Props {
  target?: ConnectionStatusDto['target']
  apiUnavailable: boolean
  apiChecked: number
  now: number
  health: UpdateHealth
  /** The Open InvenTree link, or the reason there is none. */
  inventree: ReactNode
}

const SHORT_TIME: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' }

function shortTime(at: string | number) {
  return new Date(at).toLocaleTimeString([], SHORT_TIME)
}

/** The server menu: host, last check and the Dev badge, then its actions; diagnostics sit in Details. */
export function ConnectionDetails({
  target,
  apiUnavailable,
  apiChecked,
  now,
  health,
  inventree,
}: Props) {
  const apiFresh = apiChecked > 0 && timestampFresh(apiChecked, now)
  const targetFresh =
    target && target.freshness === 'fresh' && observationFresh(target.observed_at, now)
  const transportObserved = health.observedAt !== null && Number.isFinite(health.observedAt)
  const transportFresh =
    health.observedAt !== null && timestampFresh(health.observedAt, now, LIVE_UPDATE_FRESH_MS)
  let transport = 'Connecting live updates…'
  if (health.state === 'live') {
    if (!transportObserved) {
      transport = 'Live-update health unknown; no frame observation'
    } else if (!transportFresh) {
      transport = 'Live-update observation stale; awaiting transport confirmation'
    } else {
      transport = 'Live updates connected'
    }
  }
  if (health.state === 'polling') {
    transport = 'Live updates unavailable; polling saved state'
  }
  if (health.state === 'update_required') {
    transport = 'Application update required; preserve unsaved work before reloading'
  }
  let apiStatus = 'Application API not yet observed'
  if (apiUnavailable) {
    apiStatus = 'Application API unavailable'
  } else if (apiFresh) {
    apiStatus = 'Application API read available'
  } else if (apiChecked) {
    apiStatus = 'Application API observation stale'
  }
  let transportFreshness = 'Unknown'
  if (transportObserved) {
    transportFreshness = transportFresh ? 'Fresh' : 'Stale'
  }
  let targetObservation = 'Target not yet observed'
  if (target?.observed_at) {
    targetObservation = targetFresh ? 'Fresh target observation' : 'Stale target observation'
  }
  const navigation = safeTargetNavigation(target?.navigation_url)
  const host = navigation ? new URL(navigation).hostname : (target?.label ?? 'No configured target')

  return (
    <Body>
      <KeyValue
        rows={[
          { label: 'Host', value: host, state: 'plain' as const },
          ...(target?.version
            ? [{ label: 'Version', value: `InvenTree ${target.version}`, state: 'plain' as const }]
            : []),
          {
            label: 'Last check',
            value: target?.observed_at ? shortTime(target.observed_at) : 'Not yet checked',
            state: 'plain' as const,
          },
        ]}
      />
      {target?.kind === 'owned_test' && (
        <Line>Approvals write only to this test InvenTree, never to a real one.</Line>
      )}
      {target?.kind === 'configured' && (
        <Line>Approvals write to this InvenTree, your live inventory.</Line>
      )}
      <DevBadge />
      <Actions aria-label="Server">
        {inventree}
        <DisabledFeature explanation="Checking the connection on demand is not available yet; it is checked every 30 seconds.">
          {(disabled) => (
            <Button variant="ghost" size="sm" {...disabled}>
              Check connection now
            </Button>
          )}
        </DisabledFeature>
        <Button as="a" variant="ghost" size="sm" href="#settings/inventree">
          Server settings
        </Button>
      </Actions>
      <Details>
        <summary>Details</summary>
        <p>{apiStatus}</p>
        <p>Last API read: {apiChecked ? shortTime(apiChecked) : 'Not yet checked'}</p>
        <p>{transport}</p>
        <p>
          Transport observation: {transportFreshness} ·{' '}
          {transportObserved && health.observedAt !== null
            ? shortTime(health.observedAt)
            : 'Not yet observed'}
          {health.truncated ? ' · update coverage partial; polling remains enabled' : ''}
        </p>
        <p>{target?.label ?? 'No configured target label'}</p>
        <p>
          {targetObservation} · {target?.state ?? 'unknown'}
          {target?.failure_code ? ` · ${target.failure_code.replaceAll('_', ' ')}` : ''}
        </p>
        <p>
          A reachable read does not establish complete permissions, inventory-write capability or
          provider availability.
        </p>
      </Details>
    </Body>
  )
}

const Body = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: ${space[4]};
  padding: ${space[5]};
`

const Line = styled.p`
  margin: 0;
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`

const Actions = styled.nav`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  align-self: stretch;
  gap: ${space[2]};
  padding-top: ${space[4]};
  border-top: 1px solid ${color.line};
`

const Details = styled.details`
  align-self: stretch;
  font-size: ${typeVar.small.size};
  color: ${color.muted};
  overflow-wrap: anywhere;
  summary {
    cursor: pointer;
  }
  p {
    margin: ${space[2]} 0 0;
  }
  ${media.compact} {
    summary {
      line-height: ${size.touch};
    }
  }
`
