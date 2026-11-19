import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Banner, Button, Paragraph, SettingRow, Switch } from '#/components/ui'
import { serverQueryKey } from '#/queries/scope'
import { useApiClients, useServerScope } from '#/context'
import type { BatchDefaultsDto } from '@invimport/contracts'
import { BatchDefaultsForm } from './BatchDefaultsForm'
import { SettingsCard } from './SettingsCard'
import { SettingsSection } from './SettingsSection'

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
  const saved = useQuery({
    queryKey: key,
    queryFn: () => batchDefaults!.read(),
    enabled: batchDefaults !== undefined,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  })

  /** A read already running is older than the confirmed defaults, so it must not replace them. */
  async function adopt(confirmed: BatchDefaultsDto) {
    await queryClient.cancelQueries({ queryKey: key })
    queryClient.setQueryData(key, confirmed)
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
      {batchDefaults && !saved.isFetchedAfterMount && (
        <Paragraph role="status" $onField>
          Loading saved defaults…
        </Paragraph>
      )}
      {batchDefaults && saved.isFetchedAfterMount && saved.data && (
        <BatchDefaultsForm
          client={batchDefaults}
          loaded={saved.data}
          onLoaded={(confirmed) => void adopt(confirmed)}
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
