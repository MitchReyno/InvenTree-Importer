import styled from 'styled-components'
import { Button, KeyValue, SettingRow, Small } from '#/components/ui'
import { Input } from '#/forms'
import { color, space, typeVar } from '#/theme/generated/tokens'
import { safeTargetNavigation, targetStatus } from '#/header/observations'
import { useSharedHeaderObservations } from '#/components/masthead/HeaderObservations'
import { ConnectionDot } from '#/components/masthead/ConnectionDot'
import { SettingsCard } from './SettingsCard'
import { SettingsSection } from './SettingsSection'

const SHORT_TIME: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' }

/**
 * Settings › InvenTree: the server from the masthead's connection observation, which it never
 * reads again, and the token and import reference rows the app can't change yet.
 */
export function InvenTreeSection() {
  const observations = useSharedHeaderObservations()
  const connection = observations?.connection
  const unavailable = connection ? connection.isError || connection.fetchStatus === 'paused' : false
  const target = connection?.isFetchedAfterMount ? connection.data?.target : undefined
  const status = targetStatus(target, unavailable, observations?.now ?? Date.now())
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
        <SettingRow
          label="API token"
          help="Kept on the server and never shown."
          disabledReason="Not available yet: the token is set in the server's environment, and its status isn't read here."
        >
          {({ disabled }) => (
            <Actions>
              <Button variant="ghost" size="sm" {...disabled}>
                Check now
              </Button>
              <Button variant="ghost" size="sm" {...disabled}>
                Replace token…
              </Button>
            </Actions>
          )}
        </SettingRow>
        <SettingRow
          label="Import reference prefix"
          help="Stamped on every stock item, so a retried approval can't add stock twice."
          disabledReason="Not available yet: the server sets the import reference, and it can't be changed here."
        >
          {({ named, disabled }) => <Prefix type="text" readOnly {...named} {...disabled} />}
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
  gap: ${space[4]};
`

const Prefix = styled(Input)`
  max-width: 120px;
`
