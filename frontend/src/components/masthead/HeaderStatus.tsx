import { useState } from 'react'
import styled from 'styled-components'
import { color, typeVar } from '#/theme/generated/tokens'
import { Button, IconButton, SettingsIcon } from '#/components/ui'
import type { HeaderClient } from '#/header/types'
import { useHeaderObservations } from '#/header/useHeaderObservations'
import { safeTargetNavigation } from '#/header/observations'
import { useUpdateHealth } from '#/components/operations/LiveUpdates'
import { ActivityIndicator } from './ActivityIndicator'
import { ConnectionStatus } from './ConnectionStatus'

interface Props {
  client: HeaderClient
  batchId?: string
  bootstrapUnavailable?: boolean
}

/** The masthead's status group: activity, the connection's server menu and Settings, one panel open at a time. */
export function HeaderStatus({ client, batchId, bootstrapUnavailable = false }: Props) {
  const { now, connection, work } = useHeaderObservations(client, batchId)
  const health = useUpdateHealth()
  const [open, setOpen] = useState<'connection' | 'workflow' | null>(null)
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

  return (
    <StatusRow aria-label="Application status">
      <ActivityIndicator
        data={work.isFetchedAfterMount ? work.data : undefined}
        batchId={batchId}
        unavailable={workUnavailable}
        now={now}
        open={open === 'workflow'}
        onOpenChange={(value) => setOpen(value ? 'workflow' : null)}
      />
      <ConnectionStatus
        target={target}
        unavailable={connectionUnavailable}
        apiChecked={connection.isFetchedAfterMount ? connection.dataUpdatedAt : 0}
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
