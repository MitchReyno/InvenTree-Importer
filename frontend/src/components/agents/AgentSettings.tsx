import { useQuery } from '@tanstack/react-query'
import type { agentsClient } from '@invimport/contracts/client'
import { serverQueryKey, useServerScope } from '../../queries/scope'
import { Notice, PageTitle, Panel, Paragraph } from '../ui/primitives'
import { Button } from '../ui/Button'
import { AgentSettingsForm } from './AgentSettingsForm'

interface Props {
  client: ReturnType<typeof agentsClient>
  onDirtyChange: (dirty: boolean) => void
}

export function AgentSettings({ client, onDirtyChange }: Props) {
  const scope = useServerScope()
  const query = useQuery({
    queryKey: serverQueryKey(scope, 'agent-settings'),
    queryFn: () => client.settings(),
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  })
  return (
    <Panel>
      <PageTitle>Agent settings</PageTitle>
      <Paragraph>One global default for all new agents, across every batch and stage.</Paragraph>
      {(query.isError || query.fetchStatus === 'paused') && (
        <Notice role="alert">
          Settings unavailable. Unsaved input is preserved.{' '}
          <Button onClick={() => void query.refetch()}>Retry</Button>
        </Notice>
      )}
      {!query.isFetchedAfterMount && <Paragraph role="status">Loading saved settings…</Paragraph>}
      {query.isFetchedAfterMount && query.data && (
        <AgentSettingsForm initial={query.data} client={client} onDirtyChange={onDirtyChange} />
      )}
    </Panel>
  )
}
