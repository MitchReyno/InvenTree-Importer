import styled from 'styled-components'
import { Button, KeyValue, SettingRow, Small } from '#/components/ui'
import { color, space, typeVar } from '#/theme/generated/tokens'
import { observationFresh, safeTargetNavigation, targetStatus } from '#/header/observations'
import { useSharedHeaderObservations } from '#/context'
import { ConnectionDot } from '#/components/masthead/ConnectionDot'
import { IntakeConnectionLabel } from '#/context/IntakeConnection'
import { SettingsCard } from './SettingsCard'
import { SettingsSection } from './SettingsSection'
import { ApiTokenRow } from './ApiTokenRow'

const SHORT_TIME: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' }

/**
 * Settings › InvenTree: the server from the masthead's connection observation, which it never
 * reads again, the read token, and the fixed import reference.
 */
export function InvenTreeSection({
  onDirtyChange,
}: {
  /** Reports a typed replacement token to the navigation guard. */
  onDirtyChange?: (dirty: boolean) => void
}) {
  const observations = useSharedHeaderObservations()
  const disconnected = observations?.disconnected ?? false
  const unavailable = observations?.scopedUnavailable ?? false
  const target = observations?.target
  const now = observations?.now ?? Date.now()
  const status = targetStatus(target, unavailable, now, disconnected)
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
                {
                  label: 'Intake server',
                  value: 'Intake connection',
                  content: <IntakeConnectionLabel scopeFailed={unavailable} />,
                  state: 'plain',
                },
                {
                  label: 'InvenTree server',
                  value: unavailable ? 'Current status unknown' : status.short,
                  state: 'plain',
                },
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
        <ApiTokenRow
          target={target}
          current={current}
          observations={observations}
          onDirtyChange={onDirtyChange}
        />
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
