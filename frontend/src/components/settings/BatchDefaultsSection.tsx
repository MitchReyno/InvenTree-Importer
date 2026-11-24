import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Banner, Button, DisplayOnly, ReadState, SettingRow, Switch } from '#/components/ui'
import { serverQueryKey } from '#/queries/scope'
import { useFreshRead } from '#/queries/useFreshRead'
import { useApiClients, useReportRefreshing, useServerScope } from '#/context'
import type { BatchDefaultsDto } from '@invimport/contracts'
import { BatchDefaultsForm } from './BatchDefaultsForm'
import { SettingsCard } from './SettingsCard'
import { newestRevision } from './newest-revision'
import { SettingsSection } from './SettingsSection'
import { SettingsSkeleton } from './SettingsSkeleton'

/** Settings › Batch defaults: the location and supplier each new batch starts with. */
export function BatchDefaultsSection({
  onDirtyChange,
}: {
  onDirtyChange: (dirty: boolean) => void
}) {
  const { batchDefaults } = useApiClients()
  const scope = useServerScope()
  const queryClient = useQueryClient()
  const key = serverQueryKey(scope, 'batch-defaults')
  const fresh = useFreshRead({
    queryKey: key,
    queryFn: () => batchDefaults!.read(),
    enabled: batchDefaults !== undefined,
  })
  const saved = fresh.query

  // The form opens only once a read has succeeded this visit, never on cached defaults; a later
  // failed refresh keeps it, and its choice, open.
  const [readThisVisit, setReadThisVisit] = useState(false)
  if (!readThisVisit && fresh.commandsReady) {
    setReadThisVisit(true)
  }
  const loaded = readThisVisit ? saved.data : undefined
  // Until then, defaults cached from an earlier visit show read-only.
  const cached = loaded ? undefined : saved.data
  useReportRefreshing(saved.data !== undefined && saved.isFetching)

  /**
   * Publishes confirmed defaults and answers with the newest known. A read already running, or a
   * reload older than what a refresh loaded meanwhile, never replaces newer defaults.
   */
  function adopt(confirmed: BatchDefaultsDto) {
    const latest = newestRevision(confirmed, queryClient.getQueryData<BatchDefaultsDto>(key))
    if (latest !== confirmed) {
      return latest
    }
    void queryClient
      .cancelQueries({ queryKey: key })
      .then(() => queryClient.setQueryData(key, confirmed))
    return confirmed
  }

  return (
    <SettingsSection
      title="Batch defaults"
      lead="New batches start with these. Each batch can change them in Capture › Batch settings; existing batches keep theirs."
    >
      {!batchDefaults && (
        <div role="status">
          <Banner tone="info">Batch defaults are unavailable for this setup.</Banner>
        </div>
      )}
      {(saved.isError || saved.fetchStatus === 'paused') && (
        <div role="alert">
          <Banner tone="warn" action={<Button onClick={() => void saved.refetch()}>Retry</Button>}>
            Batch defaults unavailable. Unsaved input is preserved.
          </Banner>
        </div>
      )}
      {batchDefaults && !loaded && !cached && !saved.isError && (
        <ReadState phase="empty" skeleton={<SettingsSkeleton />}>
          {null}
        </ReadState>
      )}
      {batchDefaults && cached && (
        <DisplayOnly>
          <BatchDefaultsForm
            client={batchDefaults}
            loaded={cached}
            onLoaded={adopt}
            onDirtyChange={onDirtyChange}
          />
        </DisplayOnly>
      )}
      {batchDefaults && loaded && (
        <BatchDefaultsForm
          client={batchDefaults}
          loaded={loaded}
          onLoaded={adopt}
          onDirtyChange={onDirtyChange}
        />
      )}
      <SettingsCard aria-label="Tags">
        <SettingRow
          label="Tags"
          help="Tag suggestions are under Agents › Tag suggestions."
          disabledReason="Not available yet: add the tag in Capture › Batch settings for now."
        >
          {({ disabled }) => (
            <Switch
              label="Tag every Part with its batch name"
              checked={false}
              onChange={() => {}}
              {...disabled}
            />
          )}
        </SettingRow>
      </SettingsCard>
    </SettingsSection>
  )
}
