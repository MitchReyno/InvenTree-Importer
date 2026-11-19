import styled from 'styled-components'
import type { ConnectionStatusDto } from '@invimport/contracts'
import { Button, DisabledFeature, KeyValue, SettingRow, Small } from '#/components/ui'
import { CheckConnectionButton } from '#/components/masthead/CheckConnectionButton'
import { color, space, typeVar } from '#/theme/generated/tokens'
import { observationFresh, safeTargetNavigation, targetStatus } from '#/header/observations'
import { useSharedHeaderObservations } from '#/context'
import { ConnectionDot } from '#/components/masthead/ConnectionDot'
import { SettingsCard } from './SettingsCard'
import { SettingsSection } from './SettingsSection'

const SHORT_TIME: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' }

const TOKEN_STATUS = { accepted: 'Accepted', refused: 'Refused', unavailable: 'Unavailable' }

/**
 * A fresh reachable read proves the token works and a fresh 401 or 403 is a refusal. A stale
 * observation or a failed read says nothing current, so it is Unavailable.
 */
function tokenStatus(target: ConnectionStatusDto['target'] | undefined, current: boolean) {
  if (!current) {
    return 'unavailable'
  }
  if (target?.state === 'reachable') {
    return 'accepted'
  }
  return target?.failure_code === 'unauthorized' ? 'refused' : 'unavailable'
}

/**
 * Settings › InvenTree: the server from the masthead's connection observation, which it never
 * reads again, and the token and import reference rows the app can't change yet.
 */
export function InvenTreeSection() {
  const observations = useSharedHeaderObservations()
  const connection = observations?.connection
  const unavailable = connection ? connection.isError || connection.fetchStatus === 'paused' : false
  const target = connection?.isFetchedAfterMount ? connection.data?.target : undefined
  const now = observations?.now ?? Date.now()
  const status = targetStatus(target, unavailable, now)
  const current =
    !unavailable && target?.freshness === 'fresh' && observationFresh(target.observed_at, now)
  const navigation = safeTargetNavigation(target?.navigation_url)

  return (
    <SettingsSection title="InvenTree" lead="The server approvals write to.">
      <SettingsCard aria-label="Server">
        <SettingRow label="Server" help="Approvals write here.">
          <Stack>
            <Status>
              <ConnectionDot tone={status.tone} />
              {status.summary}
            </Status>
            <KeyValue
              rows={[
                { label: 'Name', value: target?.label ?? 'No configured target', state: 'plain' },
                {
                  label: 'Last check',
                  value: target?.observed_at
                    ? new Date(target.observed_at).toLocaleTimeString([], SHORT_TIME)
                    : 'Not yet checked',
                  state: 'plain',
                },
              ]}
            />
            {navigation ? (
              <Button
                as="a"
                variant="ghost"
                size="sm"
                aria-label="Open InvenTree"
                href={navigation}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open InvenTree ↗
              </Button>
            ) : (
              <Small>Open InvenTree unavailable</Small>
            )}
            {target?.kind === 'owned_test' && (
              <Small>Approvals write only to this test InvenTree, never to a real one.</Small>
            )}
            {target?.kind === 'configured' && (
              <Small>Approvals write to this InvenTree, your live inventory.</Small>
            )}
          </Stack>
        </SettingRow>
        <SettingRow label="API token" help="Kept on the server and never shown.">
          <Stack>
            <Status>
              {TOKEN_STATUS[tokenStatus(target, current)]}
              {target?.observed_at && (
                <Small>
                  · checked {new Date(target.observed_at).toLocaleTimeString([], SHORT_TIME)}
                </Small>
              )}
            </Status>
            <Actions>
              {observations && (
                <CheckConnectionButton check={observations.check} label="Check now" />
              )}
              <DisabledFeature explanation="Not available yet: the token is set in the server's environment.">
                {(disabled) => (
                  <Button variant="ghost" size="sm" {...disabled}>
                    Replace token…
                  </Button>
                )}
              </DisabledFeature>
            </Actions>
          </Stack>
        </SettingRow>
        <SettingRow
          label="Import reference"
          help="The fixed reference the server gives each stock item it sends. It can't be changed."
        >
          <Stack>
            <code>bi1:‹batch source›:‹lot›</code>
            <Small>For example, bi1:7d1c3e9a-…-1b2c3d4e5f60:0b9f2c41-…-2e8f4a6d1b37</Small>
          </Stack>
        </SettingRow>
      </SettingsCard>
    </SettingsSection>
  )
}

const Stack = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: ${space[4]};
  small {
    color: ${color.muted};
  }
`

const Status = styled.span`
  display: inline-flex;
  align-items: center;
  gap: ${space[3]};
  font-weight: ${typeVar.bodyStrong.weight};
`

const Actions = styled.span`
  display: inline-flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: ${space[4]};
`
