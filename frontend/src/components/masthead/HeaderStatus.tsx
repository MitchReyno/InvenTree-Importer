import { useState } from 'react'
import styled from 'styled-components'
import { color, typeVar } from '#/theme/generated/tokens'
import { Button, IconButton, media, SettingsIcon, useMediaQuery } from '#/components/ui'
import type { HeaderClient } from '#/header/types'
import type { useHeaderObservations } from '#/header/useHeaderObservations'
import { safeTargetNavigation, targetStatus } from '#/header/observations'
import { useUpdateHealth } from '#/components/operations/LiveUpdates'
import { ActivityIndicator } from './ActivityIndicator'
import { ConnectionDetails } from './ConnectionDetails'
import { ConnectionStatus } from './ConnectionStatus'
import { HeaderObservationsProvider, useSharedHeaderObservations } from './HeaderObservations'
import { PhoneMenu } from './PhoneMenu'

interface Props {
  client: HeaderClient
  batchId?: string
  bootstrapUnavailable?: boolean
  /** `condensed` is the sticky phone row's copy: the mark and spinner, then the menu. */
  variant?: 'bar' | 'condensed'
}

type Panel = 'connection' | 'workflow' | 'menu'

/**
 * The masthead's status group, one panel open at a time. On a desktop: activity, the connection's
 * server menu and Settings. At phone width: the agents status button and a menu holding Agents,
 * Settings, the server and the theme, its button carrying the connection dot. Under a
 * `HeaderObservationsProvider` it shows the provider's reads; alone it reads for itself.
 */
export function HeaderStatus(props: Props) {
  const shared = useSharedHeaderObservations()

  if (shared) {
    return <HeaderStatusView {...props} observations={shared} />
  }

  return (
    <HeaderObservationsProvider client={props.client} batchId={props.batchId}>
      <SharedHeaderStatus {...props} />
    </HeaderObservationsProvider>
  )
}

function SharedHeaderStatus(props: Props) {
  const shared = useSharedHeaderObservations()

  return shared && <HeaderStatusView {...props} observations={shared} />
}

type ViewProps = Omit<Props, 'client'> & { observations: ReturnType<typeof useHeaderObservations> }

function HeaderStatusView({
  batchId,
  bootstrapUnavailable = false,
  variant = 'bar',
  observations,
}: ViewProps) {
  const { now, connection, work } = observations
  const health = useUpdateHealth()
  const phone = useMediaQuery(media.compact)
  const [open, setOpen] = useState<Panel | null>(null)
  const connectionUnavailable =
    bootstrapUnavailable || connection.isError || connection.fetchStatus === 'paused'
  const workUnavailable = bootstrapUnavailable || work.isError || work.fetchStatus === 'paused'
  const target = connection.isFetchedAfterMount ? connection.data?.target : undefined
  const navigation = safeTargetNavigation(target?.navigation_url)
  const inventreeLink = navigation ? (
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
    <UnavailableLink>Open InvenTree unavailable</UnavailableLink>
  )

  const apiChecked = connection.isFetchedAfterMount ? connection.dataUpdatedAt : 0
  const activity = (
    <ActivityIndicator
      data={work.isFetchedAfterMount ? work.data : undefined}
      batchId={batchId}
      unavailable={workUnavailable}
      now={now}
      layout={variant === 'condensed' ? 'condensed' : phone ? 'phone' : 'bar'}
      open={open === 'workflow'}
      onOpenChange={(value) => setOpen(value ? 'workflow' : null)}
    />
  )

  if (variant === 'condensed' || phone) {
    return (
      <StatusRow aria-label="Application status">
        {activity}
        <PhoneMenu
          announce={variant === 'bar'}
          status={targetStatus(target, connectionUnavailable, now)}
          server={
            <ConnectionDetails
              target={target}
              apiUnavailable={connectionUnavailable}
              apiChecked={apiChecked}
              now={now}
              health={health}
              inventree={inventreeLink}
            />
          }
          open={open === 'menu'}
          onOpenChange={(value) => setOpen(value ? 'menu' : null)}
        />
      </StatusRow>
    )
  }

  return (
    <StatusRow aria-label="Application status">
      {activity}
      <ConnectionStatus
        target={target}
        unavailable={connectionUnavailable}
        apiChecked={apiChecked}
        now={now}
        health={health}
        inventree={inventreeLink}
        open={open === 'connection'}
        onOpenChange={(value) => setOpen(value ? 'connection' : null)}
      />
      <IconButton href="#settings" label="Settings" icon={<SettingsIcon />} />
    </StatusRow>
  )
}

// The masthead's end group lays these out in one row with its menu.
const StatusRow = styled.div`
  display: contents;
`

const UnavailableLink = styled.span`
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`
