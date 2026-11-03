import type { ConnectionStatusDto } from '@invimport/contracts'
import type { UpdateHealth } from '../operations/LiveUpdates'
import { Paragraph, Small, Subheading } from '../ui/primitives'
import { HEADER_FRESH_MS, observationFresh } from '../../header/observations'

interface Props {
  target?: ConnectionStatusDto['target']
  apiUnavailable: boolean
  apiChecked: number
  now: number
  health: UpdateHealth
}

export function ConnectionDetails({ target, apiUnavailable, apiChecked, now, health }: Props) {
  const apiFresh = apiChecked > 0 && now - apiChecked < HEADER_FRESH_MS
  const targetFresh =
    target && target.freshness === 'fresh' && observationFresh(target.observed_at, now)
  let transport = 'Connecting live updates…'
  if (health.state === 'live') {
    transport = 'Live updates connected'
  }
  if (health.state === 'polling') {
    transport = 'Live updates unavailable; polling saved state'
  }
  if (health.state === 'update_required') {
    transport = 'Application update required; preserve unsaved work before reloading'
  }
  return (
    <>
      <Subheading>Application API</Subheading>
      <Paragraph>
        {apiUnavailable
          ? 'Application API unavailable'
          : apiFresh
            ? 'Application API read available'
            : apiChecked
              ? 'Application API observation stale'
              : 'Application API not yet observed'}
      </Paragraph>
      <Small>
        Last API read: {apiChecked ? new Date(apiChecked).toLocaleString() : 'Not yet checked'}
      </Small>
      <Subheading>Update transport</Subheading>
      <Paragraph>{transport}</Paragraph>
      <Small>
        Transport observation:{' '}
        {health.observedAt ? new Date(health.observedAt).toLocaleString() : 'Not yet observed'}
        {health.truncated ? ' · update coverage partial; polling remains enabled' : ''}
      </Small>
      <Subheading>InvenTree target</Subheading>
      <Paragraph>{target?.label ?? 'No configured target label'}</Paragraph>
      <Paragraph>
        {targetFresh
          ? 'Fresh target observation'
          : target?.observed_at
            ? 'Stale target observation'
            : 'Target not yet observed'}{' '}
        · {target?.state ?? 'unknown'}
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
