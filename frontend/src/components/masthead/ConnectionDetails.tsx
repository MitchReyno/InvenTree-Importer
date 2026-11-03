import type { ConnectionStatusDto } from '@invimport/contracts'
import { LIVE_UPDATE_FRESH_MS, type UpdateHealth } from '../operations/LiveUpdates'
import { Paragraph, Small, Subheading } from '../ui/primitives'
import { observationFresh, timestampFresh } from '../../header/observations'

interface Props {
  target?: ConnectionStatusDto['target']
  apiUnavailable: boolean
  apiChecked: number
  now: number
  health: UpdateHealth
}

export function ConnectionDetails({ target, apiUnavailable, apiChecked, now, health }: Props) {
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
  return (
    <>
      <Subheading>Application API</Subheading>
      <Paragraph>{apiStatus}</Paragraph>
      <Small>
        Last API read: {apiChecked ? new Date(apiChecked).toLocaleString() : 'Not yet checked'}
      </Small>
      <Subheading>Update transport</Subheading>
      <Paragraph>{transport}</Paragraph>
      <Small>
        Transport observation: {transportFreshness} ·{' '}
        {transportObserved && health.observedAt !== null
          ? new Date(health.observedAt).toLocaleString()
          : 'Not yet observed'}
        {health.truncated ? ' · update coverage partial; polling remains enabled' : ''}
      </Small>
      <Subheading>InvenTree target</Subheading>
      <Paragraph>{target?.label ?? 'No configured target label'}</Paragraph>
      <Paragraph>
        {targetObservation} · {target?.state ?? 'unknown'}
        {target?.failure_code ? ` · ${target.failure_code.replaceAll('_', ' ')}` : ''}
      </Paragraph>
      <Small>
        Last target check:{' '}
        {target?.observed_at ? new Date(target.observed_at).toLocaleString() : 'Not yet checked'}
      </Small>
      <Paragraph>
        A reachable read does not establish complete permissions, inventory-write capability or
        provider availability.
      </Paragraph>
    </>
  )
}
